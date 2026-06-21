/**
 * Registry (de)serialization for persistence.
 *
 * A ContactRegistry holds Uint8Array fields (contact bytes, signatures), which
 * aren't JSON-safe, so the persisted store keeps each binding in its serialized
 * base64-JSON form. These pure helpers convert between the two.
 *
 * `deserializeRegistry` parses only — it does NOT re-verify signatures
 * (verification happens at addBinding, before anything is ever stored). Malformed
 * entries are dropped rather than throwing, so a corrupted persisted blob
 * degrades to "fewer contacts," never a crash.
 */
import { parseSignedBinding, serializeSignedBinding, type SignedContactBinding } from './contactBinding';
import type { ContactRegistry } from './contactRegistry';

/** JSON-safe shape: account SS58 → serialized binding strings. */
export type SerializedRegistry = Record<string, string[]>;

export function serializeRegistry(registry: ContactRegistry): SerializedRegistry {
  const out: SerializedRegistry = {};
  for (const [account, bindings] of Object.entries(registry.byAccount)) {
    out[account] = bindings.map(serializeSignedBinding);
  }
  return out;
}

export function deserializeRegistry(serialized: SerializedRegistry | undefined | null): ContactRegistry {
  const byAccount: ContactRegistry['byAccount'] = {};
  for (const [account, list] of Object.entries(serialized ?? {})) {
    const bindings: SignedContactBinding[] = [];
    for (const s of list ?? []) {
      const parsed = parseSignedBinding(s);
      if (parsed) bindings.push(parsed);
    }
    if (bindings.length) byAccount[account] = bindings;
  }
  return { byAccount };
}
