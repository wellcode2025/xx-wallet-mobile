/**
 * Tests for the pure helpers in the cMix session module. The session
 * orchestration itself (NewCmix/LoadCmix/follower) is integration-level and
 * not unit-tested, per the project's "pure logic only" rule.
 */
import { describe, expect, it } from 'vitest';
import { buildCmixParams, HealthTracker } from './session';

const encode = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
const decode = (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b));

describe('buildCmixParams', () => {
  it('sets Network.EnableImmediateSending=true and preserves other fields', () => {
    const input = encode({ Network: { EnableImmediateSending: false, RoundTries: 10 }, Other: 2 });
    const out = decode(buildCmixParams(input));
    expect(out.Network.EnableImmediateSending).toBe(true);
    expect(out.Network.RoundTries).toBe(10);
    expect(out.Other).toBe(2);
  });

  it('returns the input bytes unchanged on malformed JSON', () => {
    const input = new TextEncoder().encode('not json {');
    expect(buildCmixParams(input)).toBe(input);
  });

  it('returns the input bytes unchanged when there is no Network key', () => {
    const input = encode({ Other: 1 });
    expect(buildCmixParams(input)).toBe(input);
  });
});

describe('HealthTracker', () => {
  it('starts unhealthy', () => {
    expect(new HealthTracker().healthy).toBe(false);
  });

  it('notifies subscribers on change and dedupes repeats', () => {
    const h = new HealthTracker();
    const seen: boolean[] = [];
    h.subscribe((v) => seen.push(v));
    h.set(true);
    h.set(true); // repeat — should not notify again
    h.set(false);
    expect(seen).toEqual([true, false]);
    expect(h.healthy).toBe(false);
  });

  it('stops notifying after unsubscribe', () => {
    const h = new HealthTracker();
    const seen: boolean[] = [];
    const off = h.subscribe((v) => seen.push(v));
    h.set(true);
    off();
    h.set(false);
    expect(seen).toEqual([true]);
  });

  it('supports multiple independent subscribers', () => {
    const h = new HealthTracker();
    const a: boolean[] = [];
    const b: boolean[] = [];
    h.subscribe((v) => a.push(v));
    const offB = h.subscribe((v) => b.push(v));
    h.set(true);
    offB();
    h.set(false);
    expect(a).toEqual([true, false]);
    expect(b).toEqual([true]);
  });
});
