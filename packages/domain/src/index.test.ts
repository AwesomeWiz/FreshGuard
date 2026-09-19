import { describe, expect, it } from 'vitest';
import {
  evaluateMonitoringState,
  type DeviceConfig,
  type DeviceMonitoringState,
} from './index.js';

const config: DeviceConfig = {
  maxTemperatureC: 8,
  breachGraceSeconds: 20,
  recoveryGraceSeconds: 15,
  staleAfterSeconds: 20,
};

const state = (
  monitoringState: DeviceMonitoringState['monitoringState'],
  overrides: Partial<DeviceMonitoringState> = {},
): DeviceMonitoringState => ({
  monitoringState,
  breachStartedAt: null,
  recoveryStartedAt: null,
  lastProcessedAt: null,
  ...overrides,
});

const reading = (observedAt: string, temperatureC: number) => ({ observedAt, temperatureC });

describe('evaluateMonitoringState', () => {
  it('keeps NORMAL for a normal reading', () => {
    const result = evaluateMonitoringState({
      previous: state('NORMAL'),
      reading: reading('2026-09-17T10:00:00.000Z', 7),
      config,
    });

    expect(result.next.monitoringState).toBe('NORMAL');
    expect(result.action).toEqual({ type: 'NONE' });
  });

  it('moves NORMAL to WATCHING and starts the breach window', () => {
    const observedAt = '2026-09-17T10:00:00.000Z';
    const result = evaluateMonitoringState({
      previous: state('NORMAL'),
      reading: reading(observedAt, 8.1),
      config,
    });

    expect(result.next.monitoringState).toBe('WATCHING');
    expect(result.next.breachStartedAt).toBe(observedAt);
    expect(result.action).toEqual({ type: 'NONE' });
  });

  it('moves WATCHING back to NORMAL when temperature clears before grace', () => {
    const result = evaluateMonitoringState({
      previous: state('WATCHING', {
        breachStartedAt: '2026-09-17T10:00:00.000Z',
        lastProcessedAt: '2026-09-17T10:00:00.000Z',
      }),
      reading: reading('2026-09-17T10:00:10.000Z', 7.9),
      config,
    });

    expect(result.next.monitoringState).toBe('NORMAL');
    expect(result.next.breachStartedAt).toBeNull();
    expect(result.action).toEqual({ type: 'NONE' });
  });

  it('keeps WATCHING while the breach grace period is incomplete', () => {
    const result = evaluateMonitoringState({
      previous: state('WATCHING', {
        breachStartedAt: '2026-09-17T10:00:00.000Z',
        lastProcessedAt: '2026-09-17T10:00:00.000Z',
      }),
      reading: reading('2026-09-17T10:00:19.999Z', 9),
      config,
    });

    expect(result.next.monitoringState).toBe('WATCHING');
    expect(result.action).toEqual({ type: 'NONE' });
  });

  it('moves WATCHING to ACTIVE exactly when breach grace is satisfied', () => {
    const observedAt = '2026-09-17T10:00:20.000Z';
    const result = evaluateMonitoringState({
      previous: state('WATCHING', {
        breachStartedAt: '2026-09-17T10:00:00.000Z',
        lastProcessedAt: '2026-09-17T10:00:00.000Z',
      }),
      reading: reading(observedAt, 9),
      config,
    });

    expect(result.next.monitoringState).toBe('ACTIVE');
    expect(result.action).toEqual({ type: 'OPEN_INCIDENT', openedAt: observedAt });
  });

  it('keeps ACTIVE and emits UPDATE_INCIDENT for a high reading', () => {
    const result = evaluateMonitoringState({
      previous: state('ACTIVE', {
        breachStartedAt: '2026-09-17T10:00:00.000Z',
        lastProcessedAt: '2026-09-17T10:00:20.000Z',
      }),
      reading: reading('2026-09-17T10:00:25.000Z', 9.4),
      config,
    });

    expect(result.next.monitoringState).toBe('ACTIVE');
    expect(result.action).toEqual({ type: 'UPDATE_INCIDENT' });
  });

  it('moves ACTIVE to RECOVERING and starts the recovery window', () => {
    const observedAt = '2026-09-17T10:00:25.000Z';
    const result = evaluateMonitoringState({
      previous: state('ACTIVE', {
        breachStartedAt: '2026-09-17T10:00:00.000Z',
        lastProcessedAt: '2026-09-17T10:00:20.000Z',
      }),
      reading: reading(observedAt, 8),
      config,
    });

    expect(result.next.monitoringState).toBe('RECOVERING');
    expect(result.next.recoveryStartedAt).toBe(observedAt);
    expect(result.action).toEqual({ type: 'NONE' });
  });

  it('keeps RECOVERING while recovery grace is incomplete', () => {
    const result = evaluateMonitoringState({
      previous: state('RECOVERING', {
        breachStartedAt: '2026-09-17T10:00:00.000Z',
        recoveryStartedAt: '2026-09-17T10:00:25.000Z',
        lastProcessedAt: '2026-09-17T10:00:25.000Z',
      }),
      reading: reading('2026-09-17T10:00:39.999Z', 7.5),
      config,
    });

    expect(result.next.monitoringState).toBe('RECOVERING');
    expect(result.action).toEqual({ type: 'NONE' });
  });

  it('moves RECOVERING back to ACTIVE on a rebound and keeps the breach window', () => {
    const result = evaluateMonitoringState({
      previous: state('RECOVERING', {
        breachStartedAt: '2026-09-17T10:00:00.000Z',
        recoveryStartedAt: '2026-09-17T10:00:25.000Z',
        lastProcessedAt: '2026-09-17T10:00:25.000Z',
      }),
      reading: reading('2026-09-17T10:00:30.000Z', 8.5),
      config,
    });

    expect(result.next.monitoringState).toBe('ACTIVE');
    expect(result.next.recoveryStartedAt).toBeNull();
    expect(result.next.breachStartedAt).toBe('2026-09-17T10:00:00.000Z');
    expect(result.action).toEqual({ type: 'UPDATE_INCIDENT' });
  });

  it('moves RECOVERING to NORMAL exactly when recovery grace is satisfied', () => {
    const observedAt = '2026-09-17T10:00:40.000Z';
    const result = evaluateMonitoringState({
      previous: state('RECOVERING', {
        breachStartedAt: '2026-09-17T10:00:00.000Z',
        recoveryStartedAt: '2026-09-17T10:00:25.000Z',
        lastProcessedAt: '2026-09-17T10:00:25.000Z',
      }),
      reading: reading(observedAt, 7.5),
      config,
    });

    expect(result.next.monitoringState).toBe('NORMAL');
    expect(result.next.breachStartedAt).toBeNull();
    expect(result.next.recoveryStartedAt).toBeNull();
    expect(result.action).toEqual({ type: 'RESOLVE_INCIDENT', resolvedAt: observedAt });
  });

  it('treats temperature equal to max as non-breach', () => {
    const result = evaluateMonitoringState({
      previous: state('NORMAL'),
      reading: reading('2026-09-17T10:00:00.000Z', 8),
      config,
    });

    expect(result.next.monitoringState).toBe('NORMAL');
    expect(result.action).toEqual({ type: 'NONE' });
  });

  it('does not let an older observation rewind current state', () => {
    const previous = state('ACTIVE', {
      breachStartedAt: '2026-09-17T10:00:00.000Z',
      lastProcessedAt: '2026-09-17T10:00:30.000Z',
    });

    const result = evaluateMonitoringState({
      previous,
      reading: reading('2026-09-17T10:00:29.000Z', 7),
      config,
    });

    expect(result.next).toBe(previous);
    expect(result.action).toEqual({ type: 'NONE' });
  });
});
