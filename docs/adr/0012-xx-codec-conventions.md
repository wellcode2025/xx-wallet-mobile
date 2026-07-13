# ADR-0012: xx v206 codec conventions — enums via toJSON, structs via named field, mangle guards

- Status: accepted (retroactive capture; convention set after two production bugs, 2026-05)
- Date: 2026-07-11
- Tier: T1
- Review: independent

## Context

The xx chain runs runtime v206 with polkadot.js types that don't perfectly match auto-derived codec ergonomics. Two production bugs traced to the same root cause: auto-derived `.isFoo` / `.asFoo` enum accessors and positional tuple destructuring returned wrong or undefined values on xx types (preimages slice, council Members slice) while looking perfectly type-safe in the editor.

## Decision

When reading xx chain state: read **enums via `.toJSON()`** and branch on the plain shape; read **structs via named field access** (with existence checks), never positional tuple destructure; and include a **mangle guard** on anything address-shaped — reject values that don't decode to an SS58 string starting with "6" (xx prefix 55) rather than rendering garbage. Where a codec value is used numerically, go through explicit conversion (`.toBn()` with fallback) rather than trusting accessor shape.

## Alternatives considered

- **Fix the type definitions upstream (`@xxnetwork/types`):** the principled fix, but out of this project's control and the failure mode (silently wrong data on a wallet surface) is too dangerous to leave pending an upstream release.
- **Trust accessors case-by-case after testing:** rejected — the bugs *passed* type-checking; a uniform convention is reviewable, exceptions are not.

## Consequences

Chain-reading code is slightly more verbose and deliberately less "idiomatic polkadot.js." In exchange, an entire class of silent decode corruption is fenced off, and reviewers have a bright line: any `.isX`/`.asX` or tuple destructure on xx chain state is a review flag.

## Reversibility

Fully reversible if types are proven fixed upstream — via a superseding ADR with test evidence per surface, not by drift.
