# ADR-0004: No biometric-to-sign; fund 2FA must be chain-enforced; app lock is access-gate-only

- Status: accepted (retroactive capture, decision made 2026-06-01)
- Date: 2026-07-08
- Tier: T2
- Review: independent

## Context

Users reasonably ask for fingerprint/face unlock and for "2FA" on spending. In a browser wallet, any client-side signing gate — biometric, PIN, or otherwise — runs in the same compromised context it is meant to defend against: malware that can read the keystore can also skip the gate. WebAuthn attests presence to the *page*; it does not encrypt or release key material.

## Decision

Biometrics and PIN are offered only as an opt-in **app lock**: an access gate for viewing the wallet on a shared/borrowed/lost device, off by default, layered as PIN (scrypt-backed, works on HTTP dev origins) plus WebAuthn where the platform supports it. The app lock never touches signing — keys stay encrypted under the per-account password regardless. Real spending 2FA is offered only where the *chain* enforces it: multisig thresholds, the guided 2-of-3 two-device "protected account", Ledger hardware signing, and (future) time-delay proxies.

## Alternatives considered

- **Biometric unlock releases the signing key:** rejected — theater; single-device malware defeats it while users believe they're protected.
- **Client-side "confirm with PIN to send":** rejected for the same reason; kept only as UX friction where it aids deliberateness, never described as a security boundary.

## Consequences

Honest security copy: the wallet never claims device-local spending protection it can't deliver. The fund boundary stays exactly two things: the account password (knowledge) and chain-enforced structures (possession/threshold). Two-device approval exists because of this decision.

## Reversibility

Policy, trivially reversible in code and firmly held: any future signing-gate feature must argue against this ADR in a superseding one.
