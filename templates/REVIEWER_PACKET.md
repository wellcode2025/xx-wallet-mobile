# Reviewer Packet — <change title>

> Hand this to an **independent** review pass (a fresh Cowork session or subagent)
> for any change at **Tier 1 or above** (doctrine §4.4). The reviewer sees this
> packet *only* — not the Builder's reasoning or self-justification. The reviewer
> judges the diff against the spec and the checklist, not against a story about why
> it's fine.
>
> **Builder: do NOT include your commentary on your own correctness.** That
> exclusion is the point.

## 1. Change summary
<!-- One or two sentences: what this change does. -->

## 2. Tier + reason
- **Tier:** T1 | T2
- **Reason:** <why this tier — what boundary/exposure/blast-radius applies>

## 3. Spec (from the Plan, §4.2)
- **Intended behaviour:**
- **In scope:**
- **Explicitly out of scope:**
- **Assumptions:**
- **How it should be verified:**

## 4. The diff
<!-- For T1/T2, paste the ACTUAL diff hunks — the changed lines, not a file list
     and not a summary. The reviewer reads the code. -->

```diff
<paste git diff here>
```

## 5. Tier checklist (the reviewer runs this)

For **T1 and T2**:
- [ ] The diff matches the spec — nothing out-of-scope crept in.
- [ ] **Is the tier set too LOW?** Does anything here actually cross into a higher
      tier than declared? (Misclassification downward is the most dangerous error.)
- [ ] Boundary/exposure handled correctly (THE RULE not violated).
- [ ] No secret, key, or identity material logged, persisted in plaintext, or
      leaked across the boundary.
- [ ] Errors fail closed, not open.
- [ ] Tests cover the changed behaviour, including the failure paths.

Additionally for **T2**:
- [ ] A **non-AI check** is present and recorded (test vectors / audit tool /
      static analysis / human sign-off). An AI pass alone does NOT complete a T2
      review — see the blind-spot rule, §4.4.
- [ ] For any novel security-critical construction: human/expert sign-off obtained
      before merge.
- [ ] Reversibility / rollback path noted.

## 6. Verdict
- **Result:** PASS | BLOCK
- **Findings (if BLOCK):** <numbered list; each sends the change back to Plan/Build>

> A BLOCK is not overridden by re-explaining. Owner override follows doctrine §9
> (and at T2, the hardened path).
