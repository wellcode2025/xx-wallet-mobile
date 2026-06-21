/**
 * Decide how to obtain the device cMix secret for a given account when going
 * online. Pure — the stateful orchestration (verify password, generate/unwrap,
 * connect) lives in the online store.
 */
export type SecretAction =
  /** No device secret exists yet — generate one and wrap it under this account. */
  | 'establish'
  /** This account already wraps the device secret — unwrap it. */
  | 'unlock'
  /** A secret exists but this account isn't enabled. Bring messaging online with
   *  an already-enabled account, then add this one to the set (it needs the raw
   *  secret in hand, which is only available while online). */
  | 'needs-online-account';

export function planSecretAction(hasSecret: boolean, isEnabledForAccount: boolean): SecretAction {
  if (!hasSecret) return 'establish';
  if (isEnabledForAccount) return 'unlock';
  return 'needs-online-account';
}
