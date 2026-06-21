/**
 * Tests for the multisig coordination message schema.
 *
 * Focus: the envelope validates structurally, and a "proposed" message's hash
 * gate ALWAYS fires (a tampered package is refused at parse). Pure logic.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { hexToU8a } from '@polkadot/util';
import { blake2AsHex, cryptoWaitReady } from '@polkadot/util-crypto';
import { buildBytesPackage, type BytesPackage } from '../utils/bytesPackage';
import {
  buildAckMessage,
  buildProposedMessage,
  parseCoordinationMessage,
} from './coordinationMessage';

// Real xx network addresses (same fixtures as bytesPackage.test.ts).
const ADDR_MULTISIG = '6ZihnXBA64KAFFGfdYHxKWeWKLpw28pxPANjuSWsPp1HnU8M';
const ADDR_DEPOSITOR = '6WwjYDmMb3MuoXvWHN357UzHY9VsJpFbJYbgQ1Vz1aY2PojL';

const SAMPLE_CALL_BYTES =
  '0x040300' +
  '6e1ee5ff89f7f5c0d61f93e4b4f8a2d51e0bbf3a4c5d6e7f8091a2b3c4d5e6f7' +
  '0700' +
  '0070c9b28b2904';

let validPkg: BytesPackage;

beforeAll(async () => {
  await cryptoWaitReady();
  const callHash = blake2AsHex(hexToU8a(SAMPLE_CALL_BYTES), 256);
  validPkg = buildBytesPackage({
    multisigAddress: ADDR_MULTISIG,
    callHash,
    callData: SAMPLE_CALL_BYTES,
    proposedBy: ADDR_DEPOSITOR,
    proposedAt: { block: 23357103, index: 1 },
  });
});

describe('proposed messages', () => {
  it('round-trips a proposed memo and verifies the package', () => {
    const bytes = buildProposedMessage(validPkg);
    const parsed = parseCoordinationMessage(bytes);
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.message.action === 'proposed') {
      expect(parsed.message.package).toEqual(validPkg);
      expect(parsed.message.multisigAddress).toBe(ADDR_MULTISIG);
      expect(parsed.message.callHash).toBe(validPkg.callHash);
    }
  });

  it('refuses a proposed message whose package fails the hash gate', () => {
    // Tamper the call data so it no longer hashes to the claimed hash.
    const tampered = { kind: 'multisig.coordination', v: 1, action: 'proposed', package: { ...validPkg, callData: '0xdeadbeef' } };
    const parsed = parseCoordinationMessage(JSON.stringify(tampered));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toMatch(/call-data package/i);
    }
  });

  it('refuses a proposed message with no package', () => {
    const parsed = parseCoordinationMessage(JSON.stringify({ kind: 'multisig.coordination', v: 1, action: 'proposed' }));
    expect(parsed.ok).toBe(false);
  });
});

describe('ack messages', () => {
  it('round-trips an approved ack (lowercasing the hash)', () => {
    const hash = '0x' + 'AB'.repeat(32); // 64 hex, mixed case
    const parsed = parseCoordinationMessage(buildAckMessage('approved', ADDR_MULTISIG, hash));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.message.action).toBe('approved');
      expect(parsed.message.callHash).toBe(hash.toLowerCase());
      expect(parsed.message.multisigAddress).toBe(ADDR_MULTISIG);
    }
  });

  it('round-trips a rejected ack', () => {
    const hash = '0x' + 'cd'.repeat(32);
    const parsed = parseCoordinationMessage(buildAckMessage('rejected', ADDR_MULTISIG, hash));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.message.action).toBe('rejected');
  });

  it('refuses an ack with a malformed call hash', () => {
    expect(parseCoordinationMessage(buildAckMessage('approved', ADDR_MULTISIG, '0xabc')).ok).toBe(false);
  });

  it('refuses an ack with an invalid multisig address', () => {
    expect(parseCoordinationMessage(buildAckMessage('approved', 'not-an-address', '0x' + 'ab'.repeat(32))).ok).toBe(false);
  });
});

describe('envelope validation', () => {
  it('refuses a wrong kind', () => {
    expect(parseCoordinationMessage(JSON.stringify({ kind: 'something.else', v: 1, action: 'approved' })).ok).toBe(false);
  });

  it('refuses an unsupported future version', () => {
    const parsed = parseCoordinationMessage(JSON.stringify({ kind: 'multisig.coordination', v: 99, action: 'approved' }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toMatch(/version/i);
  });

  it('refuses an unknown action', () => {
    const parsed = parseCoordinationMessage(JSON.stringify({ kind: 'multisig.coordination', v: 1, action: 'destroy' }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toMatch(/action/i);
  });

  it('refuses non-JSON bytes and non-objects', () => {
    expect(parseCoordinationMessage(new TextEncoder().encode('not json {')).ok).toBe(false);
    expect(parseCoordinationMessage('null').ok).toBe(false);
    expect(parseCoordinationMessage(42).ok).toBe(false);
  });

  it('accepts a string payload as well as bytes', () => {
    const asString = new TextDecoder().decode(buildAckMessage('approved', ADDR_MULTISIG, '0x' + 'ab'.repeat(32)));
    expect(parseCoordinationMessage(asString).ok).toBe(true);
  });
});
