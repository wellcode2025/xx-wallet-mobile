# ADR-0017: Port the proved secret-scan fixes from selvage-labs; stop the gates failing open; retire the credential heuristic in favour of gitleaks

- Status: proposed
- Date: 2026-09-14
- Tier: T2
- Review: independent
- Non-AI-Check: test-vectors — `gates/test-gates.sh`, 65 cases, runnable, each fix mutation-tested

## Context

`gates/pre-commit` carries the doctrine's one **never-overridable** block: no
secret reaches a commit. This repository is a wallet, and its gate was the kit
v2.1 original.

The same kit was installed in `wellcode2025/selvage-labs`, where five rounds of
independent review found defects in it and fixed them there (that repository's
ADR-0002). Its ledger has carried "port the fix upstream to `xx-wallet-mobile` —
a wallet running the unpatched gate" as an open item ever since. This is that
port. **Three further defects were found during it** by the independent review
rounds — one of them in the selvage gate as well, and one of them a regression
introduced by the first attempt at fixing another.

Every defect below has the same shape, and it is the shape that matters: **the
gate printed nothing, exited 0, and had scanned no content at all.** A gate that
fails open is worse than no gate, because it is trusted.

## Decision

### Ported from selvage-labs (ADR-0002)

1. **The diff invocation gains `--no-ext-diff --no-textconv --text
   --no-relative`.** Without them a `.gitattributes` `-diff`/`binary` entry, or
   a `diff.external` setting (difftastic and friends), hides staged content from
   the scan entirely.
2. **The assignment pattern accepts a quote on either side of the separator**,
   and the `secret[_-]?key` spelling. The kit matched only bare
   `api_key=value`; the quoted forms every real secret takes in TypeScript,
   JSON, YAML and a quoted `.env` all slipped through.
3. **`grep -a` throughout**, and header lines are dropped by their real prefix
   rather than any `+++ `.
4. **A `git diff` failure BLOCKS.** The kit's `|| true` turned any git error
   into a silent empty scan and a green gate.
5. **The pattern match is a pipe into a draining `grep`** whose status is
   checked. The kit's `printf | grep -q` under `pipefail` passed every commit
   over ~64 KB of added text (SIGPIPE read as no-match).

### Found during this port

6. **Each filter stage runs and is status-checked separately.** Chained as
   `… | grep '^+' | grep -v '^+++'`, they fail open: bash reports the
   **rightmost** non-zero status, so a stage-1 grep dying with rc 2 is masked by
   stage 2's ordinary rc 1 "no match", `staged_added` comes back empty, the scan
   is skipped and the gate exits 0.

   ```
   $ bash -c 'set -o pipefail; (exit 2) | (exit 1); echo $?'
   1
   ```

   **This defect is in the selvage-labs gate too**; the fix was applied there in
   the same session, and that repository's ledger records it.

7. **`gates/xx-wallet-boundary` had the same defect, in the path CI enforces.**
   Its file filters and its content greps were chained pipelines ending in
   `|| true`. A single failing `grep` made
   `XXWALLET_BOUNDARY_STRICT=1 gates/xx-wallet-boundary --tree` — the exact CI
   invocation — exit 0 with no output while a real `@polkadot/keyring` import
   outside `src/keyring/` was staged. The file filters are now bash `case`
   statements (no subprocess, so no status to mask), and each content grep runs
   through a `scan_file` helper that distinguishes *matched*, *did not match*
   and **could not be read** — the last flags the file as UNVERIFIED rather than
   silently treating it as clean.

   Its filename handling was also made NUL-safe: `for f in $files` skipped any
   path containing a space, and a file the gate never opened reads exactly like
   a file with nothing to flag.

   Two smaller defects in the same gate were fixed alongside: a staged
   **deletion** has no blob to read, so `git rm` of an ordinary `.ts` file was
   reported UNVERIFIED and failed STRICT locally (content scans now use only the
   paths that still exist in the index); and the T2 advisory list was captured
   through `$(...)`, which drops NUL bytes, so every matched filename arrived
   concatenated into one unreadable line — in a list whose only purpose is for a
   human to read it.

### The credential heuristic is REMOVED, not narrowed

The generic `keyword = <long value>` pattern is a **guess**, unlike the
private-key and provider-token shapes. Four rounds of independent review
produced four blocking findings, every one of them inside the same forty lines:

| Round | What the heuristic did |
|---|---|
| 2 | blocked **13 committed lines of ordinary wallet code**, non-overridably — `password: signerIsLedger`, `secret = generateStorageSecret()`, the standard React `autoComplete={… : 'current-password'}`, and the keyring tests' invented passphrases |
| 3 | narrowed to "the value must contain a digit", it then **silently accepted a quoted word-based passphrase in production source** — a false negative worse than the false positive it cured, because nothing is printed for anyone to see |
| 4 | the replacement rule **accepted a bare word in `.env`, YAML and shell**, where an unquoted value is a literal; and the change **could not be committed at all**, because this ADR's own illustrative example tripped the gate it documents |
| 5 | the config-file carve-out then **blocked ordinary placeholder text** — `POSTGRES_PASSWORD: changeme-in-production` in a compose file, `DB_PASSWORD=please-set-a-real-value` in a `.env.example` |

Each fix closed the case that had been proved against it and opened the adjacent
one. **That is the shape of the problem, not bad luck.** Deciding "credential or
identifier" from a regex over a file extension does not converge, and `gitleaks`
already spends its effort on exactly this question — entropy scoring, a
maintained ruleset, a real allowlist model.

So the heuristic is deleted. What stays local:

- **The high-signal patterns** — private-key headers, `AKIA`/`ASIA`, `gh*_`,
  `xox*-`, JWT shape. Cheap, effectively zero false positives, and **they
  produced no findings in four rounds of adversarial review.**
- **All of the plumbing hardening** (fixes 1–7 above). That work is orthogonal
  to the heuristic and is the genuinely valuable half of this change.
- **`gitleaks` itself when it is installed.** Its finding blocks, and so does a
  failure to run it — never silently treated as clean. It is not required
  locally, because the gate must run on every machine before every commit, and a
  downloaded binary cannot be a hard dependency of that; when it is absent the
  gate says so rather than implying coverage it does not have.
- **The gate enters the repository root before doing any of this.**
  `gitleaks protect --staged` defaults its `--source` to the *process's* working
  directory, so a gate invoked from a subdirectory scanned only that subtree,
  did not find the repo-root `.gitleaks.toml`, and exited 0 with a staged secret
  elsewhere in the commit. `git commit` always runs hooks from the root, so an
  installed hook was never exposed; direct invocation was, and in this
  repository the daily working directory is `xx-wallet-mobile/` while `gates/`
  sits at the super-repo root. The boundary gate had always done this `cd`; the
  secret scan had not. `--source` is now also passed explicitly.
- **gitleaks is handed THIS gate's diff, never left to do its own.**
  `gitleaks protect --staged` diffs internally, and that diffing honours
  `.gitattributes`: a path marked `-diff` or `binary` is skipped silently. That
  is the same blind spot fix 1 closed for the local patterns, reopened inside
  the tool brought in to be the authority. Verified: a Slack webhook staged in
  `src/keyring/` under a `-diff` attribute passed `protect --staged` clean.
  `detect --pipe` does no diffing of its own, so the already-hardened diff is
  piped to it and gitleaks sees exactly what this gate sees.

  **It is given the ADDED lines, not the raw diff.** gitleaks is not
  diff-aware under `--pipe` — it matches a secret on a removed line exactly as
  on an added one — so piping the raw diff blocked the commit that *deletes* a
  secret. That is the remediation for the exact problem this gate exists to
  prevent, and the block is not overridable. The suite's existing "removing a
  secret is allowed" case passed anyway, by coincidence: its fixture token is
  too short to match any gitleaks rule, so it had only ever exercised the local
  pattern. It now runs against a gitleaks-shaped shim as well.

  **Accepted limitation:** a piped diff carries no filenames, so any gitleaks
  rule scoped by file path cannot fire locally. In the v8.18.4 default ruleset
  that is exactly one rule (`hashicorp-tf-password`, scoped to `.tf`/`.hcl`),
  and this repository has no such files and no custom path-scoped rules, so the
  effect today is nil. It would stop being nil the moment someone adds Terraform
  or a path-scoped rule, which is why it is written down here rather than
  discovered later.
- **CI is unchanged and remains the authority**: it already runs `gitleaks` over
  full history on every push, with `.gitleaks.toml`.

The recommendation to adopt `gitleaks` locally as well is the reviewer's, stated
plainly after round 5, and it is taken here rather than argued with.

**What this costs, stated plainly.** On a machine where gitleaks is not
installed, the only shapes caught locally are the six high-signal ones. A
generic quoted API key, a word-based passphrase, a database URL with an embedded
password, and a Stripe-shaped key all reach a commit silently — verified. The
gate prints a note saying gitleaks did not run, but that is one line of stdout
on a *successful* hook, which many git front-ends hide. Anyone who wants local
protection beyond those six shapes has to install gitleaks; CI catches the rest
at push time either way. That trade is deliberate — this gate must run on every
machine before every commit, so a downloaded binary cannot be a precondition for
committing — but it should not be described as free.

`gates/xx-wallet-boundary` stays hand-rolled. It encodes this codebase's own
structural rules — the keyring import boundary, the `dangerouslySetInnerHTML`
ban — that no generic tool knows about, and every defect found in it across
these rounds was shell plumbing rather than domain judgement, each of which
stayed fixed once corrected.

### Not ported

- selvage-labs' **Stripe key pattern** — no Stripe here.
- Its **auto-chaining of `gates/*-boundary` from `pre-commit`**. This repository
  runs the boundary gate strictly in CI over the whole tree
  (`.github/workflows/ci.yml`), which is stronger than a local advisory pass.

## Alternatives considered

- **Adopt `gitleaks` locally and delete the hand-rolled scanner.** Still
  probably the right long-term answer, and `.gitleaks.toml` already exists for
  CI. Rejected for now: it adds a downloaded binary to the one gate that must
  run on every machine before every commit. Six of the seven defects above were
  in *status handling*, not pattern matching, and would have been avoided by any
  scanner that fails closed — which is an argument for gitleaks, and is recorded
  as such in `PROJECT_STATE.md`.
- **Keep narrowing the heuristic.** Rejected after four rounds of evidence: see
  the table above. Each narrowing was correct about the case in front of it and
  wrong about the next one.
- **Leave the heuristic wide and tell people to rename variables.** That is what
  selvage-labs accepted, because its tree had no such lines. Here it meant 13
  non-overridable blocks on ordinary wallet code.
- **An allowlist file** for the false positives, like `.gitleaks.toml` has.
  Rejected on its own, and unnecessary once gitleaks does the deciding — it
  brings its own allowlist model, already configured in this repo.
- **Make gitleaks a hard local dependency.** Rejected: this gate has to run on
  every machine before every commit, and a downloaded binary cannot be a
  precondition for committing. It is used when present and CI is the authority.

## Consequences

**Four review rounds, four BLOCK verdicts, and two of the findings were defects
in the fix itself rather than in the original gate.** Round 3 caught that
requiring a digit accepted a word-based passphrase in production source; round 4
caught that the replacement rule accepted a bare word in a `.env`, and
separately that the change could not be committed at all because the ADR's own
illustrative example tripped the gate. Every fix is now mutation-tested: revert
it, and a named case fails.

That history is the argument for `gitleaks`, recorded in `PROJECT_STATE.md`. A
hand-rolled scanner needed four adversarial rounds to stop being wrong, and the
thing that found each error was someone running commands against it, never
reading it.

The gate now blocks the shapes that occur, under the git configurations, file
types and commit sizes that occur, and fails closed and loudly when it cannot
read what is staged. `gates/test-gates.sh` is the record: **82 cases**, every
proved defect reproduced as a test — including a `grep` shim that makes the
first invocation fail, and both directions of the heuristic (the identifiers it
must let through, and the word-based literals it must still catch).

`gates/pre-commit` and `gates/xx-wallet-boundary` are no longer byte-identical
to the kit or to selvage-labs', so a future kit update needs a three-way merge
rather than a copy. Fix 6 should be carried back into the kit
(`eng-lead-system-kit-v2`); fixes (a)–(c) are this repository's call and need not be.

**An open item for the owner, outside this change's scope.** CI runs
`gitleaks detect --source . --config .gitleaks.toml` over full history, and that
invocation has the *same* `.gitattributes` blind spot — verified: the hidden
secret above, once committed, is invisible to it too. So today there is no
backstop anywhere in the pipeline for a secret hidden that way, and a
`.gitattributes` change is an ordinary staged file, which makes it reachable by
anyone who can open a pull request. `.github/workflows/` is a T2 path and needs
its own change and its own review; `PROJECT_STATE.md` carries it.

Known gaps, accepted: an **unquoted** purely-alphabetic value is still missed —
a quoted one is not, and the high-signal patterns and gitleaks cover the rest;
bash strips NUL bytes in command substitution, so the scanned text is
not byte-identical to the diff when NULs are present — it only ever loses the
NUL itself, never surrounding content; per-file re-checks emit a bash warning
for each binary file, on the rare path where the heuristic has already matched.

## Reversibility

Trivial to revert — a handful of lines in two scripts. Reverting restores a hole
in the only gate the doctrine refuses to let anyone override, in a repository
that holds a wallet's keyring code.
