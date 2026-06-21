/**
 * Tests for the go-online secret-action decision.
 */
import { describe, expect, it } from 'vitest';
import { planSecretAction } from './secretPlan';

describe('planSecretAction', () => {
  it('establishes when no device secret exists yet', () => {
    expect(planSecretAction(false, false)).toBe('establish');
    // hasSecret=false dominates even if the enabled flag is somehow set.
    expect(planSecretAction(false, true)).toBe('establish');
  });

  it('unlocks when this account already wraps the secret', () => {
    expect(planSecretAction(true, true)).toBe('unlock');
  });

  it('needs an enabled account when a secret exists but this one is not enabled', () => {
    expect(planSecretAction(true, false)).toBe('needs-online-account');
  });
});
