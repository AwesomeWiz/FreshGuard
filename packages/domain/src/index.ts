export type MonitoringState = 'NORMAL' | 'WATCHING' | 'ACTIVE' | 'RECOVERING';

export interface DeviceConfig {
  maxTemperatureC: number;
  breachGraceSeconds: number;
  recoveryGraceSeconds: number;
  staleAfterSeconds: number;
}

export interface TelemetryReading {
  observedAt: string;
  temperatureC: number;
}

export interface DeviceMonitoringState {
  monitoringState: MonitoringState;
  breachStartedAt: string | null;
  recoveryStartedAt: string | null;
  lastProcessedAt: string | null;
}

export type MonitoringAction =
  | { type: 'NONE' }
  | { type: 'OPEN_INCIDENT'; openedAt: string }
  | { type: 'UPDATE_INCIDENT' }
  | { type: 'RESOLVE_INCIDENT'; resolvedAt: string };

export interface EvaluationInput {
  previous: DeviceMonitoringState;
  reading: TelemetryReading;
  config: DeviceConfig;
}

export interface EvaluationResult {
  next: DeviceMonitoringState;
  action: MonitoringAction;
}

const none = (): MonitoringAction => ({ type: 'NONE' });

const elapsedSeconds = (from: string, to: string): number =>
  (Date.parse(to) - Date.parse(from)) / 1000;

export function evaluateMonitoringState({
  previous,
  reading,
  config,
}: EvaluationInput): EvaluationResult {
  if (
    previous.lastProcessedAt !== null &&
    Date.parse(reading.observedAt) < Date.parse(previous.lastProcessedAt)
  ) {
    return { next: previous, action: none() };
  }

  const isBreach = reading.temperatureC > config.maxTemperatureC;
  const processedAt = reading.observedAt;

  switch (previous.monitoringState) {
    case 'NORMAL':
      if (!isBreach) {
        return {
          next: {
            ...previous,
            monitoringState: 'NORMAL',
            breachStartedAt: null,
            recoveryStartedAt: null,
            lastProcessedAt: processedAt,
          },
          action: none(),
        };
      }

      return {
        next: {
          ...previous,
          monitoringState: 'WATCHING',
          breachStartedAt: processedAt,
          recoveryStartedAt: null,
          lastProcessedAt: processedAt,
        },
        action: none(),
      };

    case 'WATCHING':
      if (!isBreach) {
        return {
          next: {
            ...previous,
            monitoringState: 'NORMAL',
            breachStartedAt: null,
            recoveryStartedAt: null,
            lastProcessedAt: processedAt,
          },
          action: none(),
        };
      }

      if (
        previous.breachStartedAt !== null &&
        elapsedSeconds(previous.breachStartedAt, processedAt) >= config.breachGraceSeconds
      ) {
        return {
          next: {
            ...previous,
            monitoringState: 'ACTIVE',
            recoveryStartedAt: null,
            lastProcessedAt: processedAt,
          },
          action: { type: 'OPEN_INCIDENT', openedAt: processedAt },
        };
      }

      return {
        next: { ...previous, lastProcessedAt: processedAt },
        action: none(),
      };

    case 'ACTIVE':
      if (isBreach) {
        return {
          next: {
            ...previous,
            recoveryStartedAt: null,
            lastProcessedAt: processedAt,
          },
          action: { type: 'UPDATE_INCIDENT' },
        };
      }

      return {
        next: {
          ...previous,
          monitoringState: 'RECOVERING',
          recoveryStartedAt: processedAt,
          lastProcessedAt: processedAt,
        },
        action: none(),
      };

    case 'RECOVERING':
      if (isBreach) {
        return {
          next: {
            ...previous,
            monitoringState: 'ACTIVE',
            recoveryStartedAt: null,
            lastProcessedAt: processedAt,
          },
          action: { type: 'UPDATE_INCIDENT' },
        };
      }

      if (
        previous.recoveryStartedAt !== null &&
        elapsedSeconds(previous.recoveryStartedAt, processedAt) >= config.recoveryGraceSeconds
      ) {
        return {
          next: {
            ...previous,
            monitoringState: 'NORMAL',
            breachStartedAt: null,
            recoveryStartedAt: null,
            lastProcessedAt: processedAt,
          },
          action: { type: 'RESOLVE_INCIDENT', resolvedAt: processedAt },
        };
      }

      return {
        next: { ...previous, lastProcessedAt: processedAt },
        action: none(),
      };
  }
}
