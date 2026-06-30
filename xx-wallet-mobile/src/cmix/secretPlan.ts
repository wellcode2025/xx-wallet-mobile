/**
 * Decide how to obtain the device cMix secret when going online with the
 * dedicated messaging passphrase. Pure — the stateful orchestration (unwrap /
 * generate, connect) lives in the online store.
 */
export type SecretAction =
  /** No device secret exists yet — generate one and wrap it under the passphrase. */
  | 'establish'
  /** A device secret exists — unwrap it with the passphrase. */
  | 'unlock';

export function planSecretAction(hasSecret: boolean): SecretAction {
  return hasSecret ? 'unlock' : 'establish';
}
