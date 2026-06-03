# Two-device approval (2-factor protection for your funds)

The wallet's optional **app lock** (a PIN, optionally with fingerprint or face)
keeps someone from *opening* the app on your phone. It does not stop a
transaction from being signed — by design. If you want a second factor on the
funds themselves, the wallet gives you a stronger tool: **two-device approval**,
built on xx network's on-chain multisig.

This page explains what it is, why it is genuinely a second factor (where an
in-app passcode is not), and — most importantly — how to set it up so that
losing one device doesn't lock you out of your own money.

## What it is

Two-device approval puts your funds in a **shared account** that is controlled
by more than one key. You decide how many of those keys must agree before
anything can be sent. The simplest useful setup is "two keys, both required":
one key lives on your everyday phone, the other on a second device you own.

To send from the shared account, one device **proposes** the transaction and the
other **approves** it. Only when enough keys have approved does the network
execute it. A thief who steals — or malware that compromises — a single device
cannot move your funds alone, because that one device can't meet the approval
threshold by itself.

This shared account is a **multisig** (multi-signature account) in xx network
terms. You don't need to know the mechanics to use it; the wallet handles
proposing, approving, and tracking pending transactions for you.

## Why this is real two-factor protection

A PIN or biometric prompt in front of the "Send" button feels like 2FA, but it
isn't — it's a check the *app* runs against itself. Anything that has already
taken over the app (a malicious browser extension, a compromised script) can
simply skip that check and sign directly. There is no outside referee.

Two-device approval is different because the rule is enforced by the **xx
network blockchain**, not by the app. The chain will reject a transfer from the
shared account that hasn't collected enough approvals, no matter what any single
device tries to do. That's what makes it a true second factor: the two keys live
in two places, and compromising one is not enough.

| | App lock (PIN / biometric) | Two-device approval (multisig) |
| --- | --- | --- |
| What it protects | Opening / viewing the app | Spending your funds |
| Enforced by | The app, on one device | The blockchain |
| Stops a stolen single device? | Slows it down | Yes — one device can't spend alone |
| Stops malware in the app? | No | Yes — it still needs the other device |

The app lock and two-device approval solve different problems, and you can use
both: the lock for everyday privacy, the shared account for real protection of
meaningful balances.

## The trade-off you must understand first

More required keys means more safety **and** more ways to get locked out. This
is the single most important thing to get right before you move funds in.

- **Two-of-two** (both keys required) is the most protective against theft, but
  it has **no margin for error**: if either device is lost, broken, or wiped —
  and you don't have that key's recovery phrase — the funds in the shared
  account are stuck. There is no reset button, no support line, no override.

For almost everyone, the better setup is:

- **Two-of-three:** three keys exist, and any **two** of them can approve. Keep
  two on devices you use (for example, your phone and a tablet) and **one as a
  cold backup** — a key you generate, write down, and store offline, never
  installed on a daily device. Day to day you approve with your two devices. If
  you lose one device, you recover by pairing your remaining device with the
  cold backup key. An attacker still needs two keys, so you keep the security;
  but a single loss is no longer fatal.

Whichever you choose, remember: **each underlying key has its own recovery
phrase, and you must back up every one of them.** The shared account's address
is derived from the full set of signer addresses plus the threshold, so as long
as you hold any *threshold*-worth of the underlying keys, you can always rebuild
access — even on a new device, even if the app disappears. Your backups are what
make that true.

## Setting it up (outline)

1. **Create or import a key on each device** you want to be a signer. Each is a
   normal xx network account with its own recovery phrase. Back up every phrase.
2. **For 2-of-3, generate a third "cold" key** and store its recovery phrase
   offline. You do not need to keep this one installed anywhere.
3. **Create the shared account** in the wallet from the list of signer addresses
   and the threshold (2). The wallet derives the shared account's address
   locally and shows it to you.
4. **Move funds into the shared account.** From now on, spending requires the
   propose-then-approve flow across your devices.

When you send, the proposing device shares the transaction details with the
approving device. The wallet shows the approver the **decoded** transaction —
exactly what is being signed, derived from the transaction's own bytes, never
from a description the other side typed. You always approve what you can see.

## What it does and doesn't protect against

**Protects against:**

- Theft or loss of a single device.
- Malware or a malicious script that takes over the wallet on one device.
- A single leaked or guessed password — one key is not enough to spend.

**Does not protect against:**

- An attacker who controls *threshold*-many of your keys (e.g. both of your
  everyday devices in a 2-of-2).
- Losing your backups. The recovery phrases for the underlying keys are still
  the ultimate source of access; the multisig does not replace them.
- Mistakes you approve. If both devices approve a transfer to the wrong place,
  the network will carry it out.

## Costs and friction

Two-device approval is deliberately a little slower than a normal send — that
friction is the point. A few practical notes:

- Each pending proposal places a small refundable **deposit** on chain, returned
  when the transaction is executed or cancelled.
- A send is a two-step action across two devices, not one tap.
- For balances you move constantly, you may prefer to keep a small everyday
  account on a single key and reserve two-device approval for savings or
  treasury-sized amounts.

## See also

- The [security policy](../SECURITY.md) explains the wallet's overall threat
  model and why the app lock is an access gate rather than a signing factor.
