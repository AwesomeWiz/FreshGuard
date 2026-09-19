import { randomUUID } from 'node:crypto';
import { PublishCommand } from '@aws-sdk/client-sns';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

type DbCommand = GetCommand | UpdateCommand;

export interface DocumentClient {
  send(command: DbCommand): Promise<{ Item?: Record<string, unknown> }>;
}

export interface SnsPublisher {
  send(command: PublishCommand): Promise<{ MessageId?: string }>;
}

export interface LogEntry {
  level: 'INFO' | 'WARN' | 'ERROR';
  operation: string;
  stage: string;
  [field: string]: unknown;
}

export interface AlertHandlerDependencies {
  db: DocumentClient;
  sns: SnsPublisher;
  stage: string;
  incidentsTable: string;
  alertTopicArn: string;
  claimLeaseSeconds?: number;
  now?: () => Date;
  claimToken?: () => string;
  log?: (entry: LogEntry) => void;
}

interface OpenedEventDetail {
  schemaVersion: 1;
  incidentId: string;
  deviceId: string;
  openedAt: string;
  breachStartedAt: string;
  thresholdC: number;
  breachGraceSeconds: number;
  temperatureAtOpenC: number;
  peakTemperatureC: number;
  doorState: 'OPEN' | 'CLOSED' | 'UNKNOWN';
  powerState: 'ON' | 'OFF' | 'UNKNOWN';
}

interface ParsedEvent {
  eventId?: string;
  detail: OpenedEventDetail;
}

type Outcome = 'ignored' | 'already_sent' | 'sent';

class AlertError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isConditionalConflict(error: unknown): boolean {
  return isRecord(error) && error.name === 'ConditionalCheckFailedException';
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function validNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseOpenedEvent(input: unknown): ParsedEvent | null {
  if (!isRecord(input)) throw new AlertError('Alert event is malformed');
  if (input.source !== 'freshguard.incidents' ||
    input['detail-type'] !== 'freshguard.incident.opened') return null;
  if (!isRecord(input.detail)) throw new AlertError('Alert event detail is malformed');
  const detail = input.detail;
  const doorStates = ['OPEN', 'CLOSED', 'UNKNOWN'];
  const powerStates = ['ON', 'OFF', 'UNKNOWN'];
  if (detail.schemaVersion !== 1 ||
    typeof detail.incidentId !== 'string' || detail.incidentId.length === 0 ||
    typeof detail.deviceId !== 'string' || detail.deviceId.length === 0 ||
    !validTimestamp(detail.openedAt) || !validTimestamp(detail.breachStartedAt) ||
    !validNumber(detail.thresholdC) || !validNumber(detail.breachGraceSeconds) ||
    !validNumber(detail.temperatureAtOpenC) || !validNumber(detail.peakTemperatureC) ||
    typeof detail.doorState !== 'string' || !doorStates.includes(detail.doorState) ||
    typeof detail.powerState !== 'string' || !powerStates.includes(detail.powerState)) {
    throw new AlertError('Alert event detail is malformed');
  }
  return {
    eventId: typeof input.id === 'string' && input.id.length > 0 ? input.id : undefined,
    detail: detail as unknown as OpenedEventDetail,
  };
}

async function loadIncident(
  db: DocumentClient,
  incidentsTable: string,
  incidentId: string,
): Promise<Record<string, unknown>> {
  const response = await db.send(new GetCommand({
    TableName: incidentsTable,
    Key: { incidentId },
    ConsistentRead: true,
  }));
  if (!response.Item) throw new AlertError('Incident could not be loaded');
  return response.Item;
}

function validateIncidentEvidence(
  incident: Record<string, unknown>,
  detail: OpenedEventDetail,
): void {
  const matches = incident.incidentId === detail.incidentId &&
    incident.deviceId === detail.deviceId &&
    incident.openedAt === detail.openedAt &&
    incident.breachStartedAt === detail.breachStartedAt &&
    incident.thresholdC === detail.thresholdC &&
    incident.breachGraceSeconds === detail.breachGraceSeconds &&
    incident.temperatureAtOpenC === detail.temperatureAtOpenC &&
    incident.temperatureAtOpenC === detail.peakTemperatureC &&
    incident.doorStateAtOpen === detail.doorState &&
    incident.powerStateAtOpen === detail.powerState;
  if (!matches) throw new AlertError('Incident and event evidence disagree');
}

function notificationMessage(incident: Record<string, unknown>): { subject: string; message: string } {
  const incidentId = String(incident.incidentId);
  const deviceId = String(incident.deviceId);
  const openedAt = String(incident.openedAt);
  const temperatureAtOpenC = Number(incident.temperatureAtOpenC);
  const thresholdC = Number(incident.thresholdC);
  const doorStateAtOpen = String(incident.doorStateAtOpen);
  const powerStateAtOpen = String(incident.powerStateAtOpen);
  const breachGraceSeconds = Number(incident.breachGraceSeconds);
  return {
    subject: `FreshGuard incident: ${deviceId}`.slice(0, 100),
    message: [
      'FreshGuard temperature incident opened.',
      `Incident ID: ${incidentId}`,
      `Device ID: ${deviceId}`,
      `Opened at: ${openedAt}`,
      `Opening temperature: ${temperatureAtOpenC} C`,
      `Configured threshold: ${thresholdC} C`,
      `Door observation: ${doorStateAtOpen}`,
      `Power observation: ${powerStateAtOpen}`,
      `Breach grace: ${breachGraceSeconds} seconds`,
    ].join('\n'),
  };
}

function validClaim(incident: Record<string, unknown>): {
  token: string;
  claimedAt: string;
} | null {
  return typeof incident.notificationClaimToken === 'string' &&
    incident.notificationClaimToken.length > 0 && validTimestamp(incident.notificationClaimedAt)
    ? { token: incident.notificationClaimToken, claimedAt: incident.notificationClaimedAt }
    : null;
}

export function createAlertHandler({
  db,
  sns,
  stage,
  incidentsTable,
  alertTopicArn,
  claimLeaseSeconds = 60,
  now = () => new Date(),
  claimToken = () => randomUUID(),
  log = (entry) => console.log(JSON.stringify(entry)),
}: AlertHandlerDependencies) {
  if (!Number.isSafeInteger(claimLeaseSeconds) || claimLeaseSeconds <= 0) {
    throw new Error('Notification claim lease must be a positive whole number');
  }

  return async (input: unknown): Promise<{ result: Outcome }> => {
    let parsed: ParsedEvent | null;
    try {
      parsed = parseOpenedEvent(input);
    } catch {
      log({ level: 'ERROR', operation: 'alert_failed', stage,
        result: 'validation_failed' });
      throw new Error('Alert event validation failed');
    }
    if (parsed === null) {
      log({ level: 'INFO', operation: 'alert_received', stage, result: 'ignored' });
      return { result: 'ignored' };
    }

    const { detail, eventId } = parsed;
    const context = {
      stage,
      incidentId: detail.incidentId,
      deviceId: detail.deviceId,
      ...(eventId ? { eventId } : {}),
    };
    log({ level: 'INFO', operation: 'alert_received', ...context, result: 'received' });

    let incident: Record<string, unknown>;
    try {
      incident = await loadIncident(db, incidentsTable, detail.incidentId);
      validateIncidentEvidence(incident, detail);
    } catch {
      log({ level: 'ERROR', operation: 'alert_failed', ...context,
        result: 'incident_load_failed' });
      throw new Error('Alert incident could not be verified');
    }

    if (incident.notificationStatus === 'SENT') {
      log({ level: 'INFO', operation: 'alert_already_sent', ...context,
        notificationStatus: 'SENT', result: 'already_sent' });
      return { result: 'already_sent' };
    }

    const claimedAt = now().toISOString();
    const token = claimToken();
    let claimCondition: string;
    let claimValues: Record<string, unknown> = {
      ':sending': 'SENDING',
      ':claimedAt': claimedAt,
      ':claimToken': token,
    };

    if (incident.notificationStatus === 'PENDING') {
      claimCondition = 'notificationStatus = :pending';
      claimValues[':pending'] = 'PENDING';
    } else if (incident.notificationStatus === 'SENDING') {
      const claim = validClaim(incident);
      if (!claim) {
        log({ level: 'ERROR', operation: 'alert_failed', ...context,
          notificationStatus: 'SENDING', result: 'invalid_claim' });
        throw new Error('Alert notification claim is invalid');
      }
      const claimAgeMs = Date.parse(claimedAt) - Date.parse(claim.claimedAt);
      if (claimAgeMs < claimLeaseSeconds * 1000) {
        log({ level: 'WARN', operation: 'alert_failed', ...context,
          notificationStatus: 'SENDING', result: 'claim_in_progress' });
        throw new Error('Alert notification is currently claimed');
      }
      claimCondition = 'notificationStatus = :sending AND notificationClaimedAt = :previousClaimedAt AND notificationClaimToken = :previousClaimToken';
      claimValues = {
        ...claimValues,
        ':previousClaimedAt': claim.claimedAt,
        ':previousClaimToken': claim.token,
      };
    } else {
      log({ level: 'ERROR', operation: 'alert_failed', ...context,
        notificationStatus: incident.notificationStatus, result: 'invalid_status' });
      throw new Error('Alert notification state is invalid');
    }

    try {
      await db.send(new UpdateCommand({
        TableName: incidentsTable,
        Key: { incidentId: detail.incidentId },
        UpdateExpression: 'SET notificationStatus = :sending, notificationClaimedAt = :claimedAt, notificationClaimToken = :claimToken',
        ConditionExpression: claimCondition,
        ExpressionAttributeValues: claimValues,
      }));
    } catch (error) {
      if (isConditionalConflict(error)) {
        try {
          const current = await loadIncident(db, incidentsTable, detail.incidentId);
          if (current.notificationStatus === 'SENT') {
            log({ level: 'INFO', operation: 'alert_already_sent', ...context,
              notificationStatus: 'SENT', result: 'already_sent' });
            return { result: 'already_sent' };
          }
          if (current.notificationStatus === 'SENDING') {
            log({ level: 'WARN', operation: 'alert_failed', ...context,
              notificationStatus: 'SENDING', result: 'claim_in_progress' });
            throw new AlertError('Alert notification is currently claimed');
          }
        } catch (reconciliationError) {
          if (reconciliationError instanceof AlertError) throw reconciliationError;
        }
      }
      log({ level: 'ERROR', operation: 'alert_failed', ...context,
        notificationStatus: incident.notificationStatus, result: 'claim_failed' });
      throw new Error('Alert notification claim failed');
    }

    log({ level: 'INFO', operation: 'alert_claimed', ...context,
      notificationStatus: 'SENDING', result: 'claimed' });
    const notification = notificationMessage(incident);
    try {
      const response = await sns.send(new PublishCommand({
        TopicArn: alertTopicArn,
        Subject: notification.subject,
        Message: notification.message,
      }));
      if (!response.MessageId) throw new AlertError('SNS did not accept the notification');
    } catch {
      let retryStatus = 'SENDING';
      try {
        await db.send(new UpdateCommand({
          TableName: incidentsTable,
          Key: { incidentId: detail.incidentId },
          UpdateExpression: 'SET notificationStatus = :pending REMOVE notificationClaimedAt, notificationClaimToken',
          ConditionExpression: 'notificationStatus = :sending AND notificationClaimToken = :claimToken',
          ExpressionAttributeValues: {
            ':pending': 'PENDING', ':sending': 'SENDING', ':claimToken': token,
          },
        }));
        retryStatus = 'PENDING';
      } catch {
        // A stuck claim becomes reclaimable after the bounded lease.
      }
      log({ level: 'ERROR', operation: 'alert_failed', ...context,
        notificationStatus: retryStatus, result: 'sns_publish_failed' });
      throw new Error('Alert notification publish failed');
    }

    const notificationSentAt = now().toISOString();
    try {
      await db.send(new UpdateCommand({
        TableName: incidentsTable,
        Key: { incidentId: detail.incidentId },
        UpdateExpression: 'SET notificationStatus = :sent, notificationSentAt = :sentAt REMOVE notificationClaimedAt, notificationClaimToken',
        ConditionExpression: 'notificationStatus = :sending AND notificationClaimToken = :claimToken',
        ExpressionAttributeValues: {
          ':sent': 'SENT', ':sentAt': notificationSentAt,
          ':sending': 'SENDING', ':claimToken': token,
        },
      }));
    } catch (error) {
      if (isConditionalConflict(error)) {
        try {
          const current = await loadIncident(db, incidentsTable, detail.incidentId);
          if (current.notificationStatus === 'SENT') {
            log({ level: 'INFO', operation: 'alert_sent', ...context,
              notificationStatus: 'SENT', result: 'reconciled' });
            return { result: 'sent' };
          }
        } catch {
          // Report the generic persistence failure below.
        }
      }
      log({ level: 'ERROR', operation: 'alert_failed', ...context,
        notificationStatus: 'SENDING', result: 'status_update_failed' });
      throw new Error('Alert notification status update failed');
    }

    log({ level: 'INFO', operation: 'alert_sent', ...context,
      notificationStatus: 'SENT', result: 'sent' });
    return { result: 'sent' };
  };
}
