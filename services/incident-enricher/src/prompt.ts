export interface IncidentEvidence {
  deviceId: string;
  incidentId: string;
  openedAt: string;
  thresholdC: number;
  breachGraceSeconds: number;
  temperatureAtOpenC: number;
  peakTemperatureC: number;
  doorState: 'OPEN' | 'CLOSED' | 'UNKNOWN';
  powerState: 'ON' | 'OFF' | 'UNKNOWN';
  breachDurationSeconds?: number;
}

export const GROUNDED_SYSTEM_PROMPT = `You summarize a cold-storage incident from structured observations.
Use only the supplied evidence and never invent readings or facts.
Never claim a proven root cause, that food is safe or unsafe, or that spoilage occurred.
Treat door state and power state as observations, never as proof of causation.
Use observation or correlation language instead of causation language.
Write only 2 to 4 concise sentences.
You may recommend checking the door or refrigeration equipment operationally.
Never present the output as a food-safety certification.`;

export function buildEvidencePrompt(evidence: IncidentEvidence): string {
  return `Summarize this incident using only the following normalized evidence:\n${JSON.stringify(evidence)}`;
}
