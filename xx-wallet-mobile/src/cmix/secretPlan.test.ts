/**
 * Tests for the go-online secret-action decision.
 */
import { describe, expect, it } from 'vitest';
import { planSecretAction } from './secretPlan';

describe('planSecretAction', () => {
  it('establishes when no device secret exists yet', () => {
    expect(planSecretAction(false)).toBe('establish');
  });

  it('unlocks when a device secret is already set', () => {
    expect(planSecretAction(true)).toBe('unlock');
  });
});
