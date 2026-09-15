# ADR-0018: CI's secret scan is blind to any path marked `-diff` or `binary` — override the attributes before scanning

- Status: proposed
- Date: 2026-09-15
- Tier: T2
- Review: independent
- Non-AI-Check: test-vectors — `gates/test-ci-secret-scan.sh`, 24 cases, runnable
  against the exact gitleaks version CI pins; it **executes the workflow's own
  step** rather than asserting about its text

## Context

ADR-0017 replaced this repository's hand-rolled credential heuristic with
`gitleaks`, on the reasoning that a maintained tool decides "credential or
identifier" far better than a regex, and that **CI is the authority**: it scans
full history on every push, and a local hook is optional and bypassable.

The review of that change then found that the authority has a hole.

`gitleaks detect --source .` walks history by **diffing it itself**, and that
diffing honours `.gitattributes`. A path marked `-diff`, or `binary` (a macro
that implies `-diff`), is skipped **silently** — no finding, no warning, exit 0.

Verified against the pinned v8.18.4, with a Slack webhook committed at
`xx-wallet-mobile/src/keyring/secret.txt` under one `.gitattributes` line:

| scan | result |
|---|---|
| `gitleaks detect --source . --config .gitleaks.toml` | **clean, exit 0** |
| the same, with the attribute removed | leak found, exit 1 |

So the attribute was the entire cause. And the local gate cannot compensate:
ADR-0017 hardened it to pipe its own `--text --no-textconv --no-ext-diff` diff
to gitleaks, which closes this locally, but the local gate is not required and
CI is what gates a merge to `main`.

**Three things make this worse than an ordinary gap.** A `.gitattributes` entry
is an ordinary file, so anyone who can open a pull request can add one. The
effect is permanent: once the secret is in history under that attribute, no
later scan finds it. And there was **no backstop anywhere in the pipeline** —
this was the only full-history scan.

This repository legitimately uses `-diff` attributes elsewhere (generated
single-file HTML, for instance, in the sibling project), so "never use `-diff`"
is not an available answer.

## Decision

**Write `* diff` to `.git/info/attributes` immediately before the scan.**

```yaml
printf '* diff\n' > .git/info/attributes
./gitleaks detect --source . --config .gitleaks.toml --redact --verbose
```

`.git/info/attributes` takes precedence over the in-tree `.gitattributes`, so
this forces git to produce a real textual diff for every path regardless of what
the repository says. `* diff` alone covers both `-diff` and the `binary` macro —
verified for each separately.

Three properties make this the right shape rather than merely a working one:

1. **It cannot be switched off from inside the repository.**
   `.git/info/attributes` is not part of the working tree, so no commit and no
   pull request can change it. A control, not a convention. There is a test for
   exactly this: a committed `.gitattributes` saying `* -diff` does not defeat it.
2. **It changes nothing else.** It is written after checkout, used only by the
   scan, and discarded with the runner. A clean repository still passes, and an
   ordinary committed secret is still found.
3. **It is one line at the point of use**, so a reader of the workflow sees the
   hazard and the mitigation together. The comment says what it is for.

## Alternatives considered

- **Add `gitleaks detect --no-git`** (a filesystem scan, which ignores git
  entirely and does catch the hidden file). Rejected as the primary fix: it
  covers only the *current tree*, so a secret committed under `-diff` and later
  deleted stays hidden, which is precisely the case that matters most. It also
  scans `node_modules/` unless the step is reordered before `npm ci`. It would
  be a reasonable addition; it is not a substitute.
- **Forbid `-diff`/`binary` attributes on source paths**, with a gate. Rejected:
  the attribute is legitimate for generated artefacts, so the rule would need an
  exception list that drifts, and it treats a symptom. The override makes the
  attribute harmless instead of policing it.
- **Strip `.gitattributes` in CI before scanning.** Equivalent in effect and
  worse in practice: it mutates the checkout, so a later step could observe a
  tree that differs from what was pushed.
- **Ask gitleaks to ignore attributes.** No such flag exists in v8.18.4; its
  history walk delegates to git.
- **Bundle this with the local-gate change (ADR-0017).** Rejected on the
  reviewer's advice: it would have mixed an unreviewed CI change into a
  thoroughly reviewed local one. This is its own change with its own review.

## Consequences

CI now sees every path in history, whatever `.gitattributes` says, and that is
the scan a merge to `main` depends on.

`gates/test-ci-secret-scan.sh` is the recorded non-AI check and is runnable: it
builds throwaway repositories, reproduces the blind spot against the pinned
gitleaks version, proves the override closes it, and proves it cannot be
defeated from inside the repository. It skips with exit 77, not 0, when gitleaks
is unavailable, so a skip cannot read as a pass.

**It extracts the workflow's own `run:` script and executes it**, under
`set -eo pipefail` — GitHub Actions' real default shell for a `run:` block — and
substituting only the tarball download for the binary already in hand.

**Three rounds of review were needed to make this test honest, and all three
findings were the same mistake at increasing depth.** Each version was a
weaker proxy standing in for "did the scan actually run and what did it say":

| version | judged by | defeated by |
|---|---|---|
| 1 | a substring in `ci.yml`'s text | an override redirected to a nonexistent path; one commented out |
| 2 | the step's **exit status** | a failing `sha256sum -c` mid-step — the next edit this file is scheduled to receive — which exits 1 exactly as "leaks found" does |
| 3 | a substring in the step's **whole output** | an ordinary log line containing the words `leaks found:`, printed before the step aborted |

The fix is structural rather than another patch on the same pattern. The
scanner invocation is replaced by a **wrapper that writes its own output to a
dedicated file**, and the verdict is read from that file alone. Nothing else in
the step can write there, so "the scanner said so" is now a fact about
provenance rather than about string matching. If the file is absent or empty,
the step is reported broken — never as a finding, never as clean.

All four mutations from the three rounds now fail: three cases each for the two
abort scenarios, four each for the two override scenarios.

A test that asserts a string appears in a file proves nothing about what that
file does. A test that checks an exit code proves nothing about which command
produced it. And a test that greps a shared stream proves nothing about who
wrote the line.

**A footnote that is really a fourth data point.** The first push of this change
was rejected by GitHub's own push protection, because the test's fixture — a
Slack webhook URL — appeared as a literal on one line. The system worked
exactly as intended, on the commit whose entire purpose is secret scanning. The
fixture is now assembled at runtime, the same discipline `gates/test-gates.sh`
already uses, so the file cannot itself be a scannable secret. It is worth
knowing that this repository has push protection enforcing at the remote,
independently of gitleaks and of anything in `gates/`.

**One limitation of the harness, and it fails closed.** The wrapper is
substituted by rewriting `./gitleaks` in the extracted step. If someone rewrites
that invocation in a style the substitution does not match — an absolute path,
or a variable holding one — the wrapper is never installed, the scanner is never
reached, and the suite reports `BROKEN` on three cases rather than passing. That
costs a maintainer a moment working out whether the workflow or the harness is
stale; it does not cost false assurance. Verified, along with the cases that do
still work: output redirected elsewhere by the step, the invocation prefixed
with `bash`, and a harmless earlier `gitleaks version` call.

The test asserts the *premise* as well as the fix — that the unfixed invocation
really is blind. If a future gitleaks stops honouring `.gitattributes`, that
case fails loudly and points here, rather than the whole thing quietly becoming
a no-op nobody revisits.

**Two limits of the fix, verified and stated so they are not mistaken for
coverage.** The override forces git to diff every path, which also recovers a
case nobody had raised: a secret in a file containing a **NUL byte** is skipped
by the history walk through git's own binary auto-detection, with no
`.gitattributes` involved at all — reachable by anyone who can commit a file.
The override fixes that too, and there is a case for it.

What it does **not** reach is gitleaks' own default allowlist, which skips
certain file extensions outright in both scan modes. Verified, and each one exercised by the
suite rather than asserted here: a plain-text secret in a `.bin`, `.jpg`,
`.pdf`, `.zip` or `.exe` file is missed with or without the override, while
`.ts` and `.txt` controls are found, because git attributes have nothing to do with it. That is
gitleaks' behaviour and the price of delegating to it; a secret committed with
such an extension is not caught by CI. The test pins this as a known limit, so
if a future gitleaks changes it, the case fails and points here.

**Not addressed, and worth its own change:** the workflow downloads the gitleaks
tarball over HTTPS with **no checksum**, so CI's secret scanner is itself
unverified supply chain. That predates this change and is recorded in
`PROJECT_STATE.md` rather than fixed here, to keep this diff to the one thing it
is about.

## Reversibility

One line. Reverting restores a permanent, silent blind spot in the only
full-history secret scan this project has.
