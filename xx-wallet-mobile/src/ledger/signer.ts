/**
 * LedgerSigner — a polkadot-js external signer that routes signing to a
 * Ledger device instead of a decrypted local keystore.
 *
 * Usage (the transaction-submit hook's Ledger branch):
 *
 *     const signer = new LedgerSigner(api.registry, account.ledger);
 *     await api.tx.balances
 *       .transferKeepAlive(dest, value)
 *       .signAndSend(account.address, { signer }, callback);
 *
 * polkadot-js hands `signPayload` the full signer payload (method bytes,
 * era, nonce, spec/tx versions, genesis + block hash). We re-encode it to
 * the canonical ExtrinsicPayload byte form — the exact bytes the chain
 * verifies — and ship those to the device. The user reads the decoded
 * call on the Ledger screen and physically confirms. The 65-byte
 * MultiSignature-encoded response (0x00 prefix = ed25519) goes back to
 * polkadot-js verbatim.
 *
 * What this signer never does: touch key material, cache signatures, or
 * mutate the payload. One payload in, one device confirmation, one
 * signature out.
 */

import type { Signer, SignerResult } from '@polkadot/api/types';
import type { Registry, SignerPayloadJSON } from '@polkadot/types/types';
import { u8aToHex } from '@polkadot/util';
import type { LedgerSlots } from './transport';

let nextSignerId = 0;

export class LedgerSigner implements Signer {
  readonly #registry: Registry;
  readonly #slots: LedgerSlots;

  constructor(registry: Registry, slots: LedgerSlots) {
    this.#registry = registry;
    this.#slots = slots;
  }

  async signPayload(payload: SignerPayloadJSON): Promise<SignerResult> {
    // Canonical signing bytes. `toU8a(true)` gives the bare payload
    // (no length prefix) — the exact byte string a Substrate chain
    // verifies the signature against. For payloads over 256 bytes the
    // device signs the blake2-256 hash instead, per the same Substrate
    // convention the chain applies on verification; the Zondax driver
    // handles that switch internally.
    const extrinsicPayload = this.#registry.createType('ExtrinsicPayload', payload, {
      version: payload.version,
    });
    const bytes = extrinsicPayload.toU8a(true);

    // getLedgerSession reconnects if the device was unplugged since the
    // last call (silently when permission was already granted). Errors
    // arrive pre-mapped to user-actionable messages. Imported lazily to
    // keep this module's static graph acyclic (index.ts re-exports us).
    const [{ getLedgerSession }, { signWithLedger }] = await Promise.all([
      import('./index'),
      import('./transport'),
    ]);
    const session = await getLedgerSession();
    const signature = await signWithLedger(session, this.#slots, bytes);

    return {
      id: ++nextSignerId,
      signature: u8aToHex(signature) as SignerResult['signature'],
    };
  }
}
