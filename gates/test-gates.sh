#!/usr/bin/env bash
# gates/test-gates.sh — runnable test vectors for the gates (the T2 non-AI check).
#
# Ported from selvage-labs alongside the pre-commit fixes (docs/adr/0017). Every
# case in the "fail-open" sections is one that an independent review PROVED
# against an installed gate: the gate printed nothing, exited 0, and had scanned
# no content at all. They are here so a future edit cannot quietly reopen them.
#
# Runs entirely in a throwaway repo under $TMPDIR; never touches this one.
# Secret fixtures are assembled at runtime so this file cannot trip the scan.
#
# Usage: gates/test-gates.sh          (run after ANY edit under gates/)
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
base="${TMPDIR:-/tmp}"
T="$(mktemp -d "$base/xxgates-test.XXXXXX")" || { echo "mktemp failed under $base — refusing to run (would otherwise run destructive setup in the current repo)"; exit 2; }
T="$(realpath "$T")" || exit 2
[ -n "$T" ] && [ -d "$T" ] && cd "$T" || { echo "cannot enter '$T'"; exit 2; }
# Shim binaries live OUTSIDE the throwaway repo: the repo IS $T, and
# `git clean -fdq` in fresh() deletes any untracked directory under it, which
# would silently leave a shim-based case testing nothing.
SHIMDIR="$(mktemp -d "$base/xxgates-shim.XXXXXX")" || exit 2
SHIMDIR="$(realpath "$SHIMDIR")" || exit 2
trap 'rm -rf "$T" "${SHIMDIR:-}"' EXIT
# An inherited GIT_INDEX_FILE / GIT_DIR (a hook in a linked worktree exports them
# absolute) would make every git command below act on the CALLER's repo.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_OBJECT_DIRECTORY GIT_NAMESPACE
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

pass=0; fail=0
ok()   { pass=$((pass+1)); printf '  ok    %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf '  FAIL  %s\n' "$1"; }
check(){ [ "$1" = "$2" ] && ok "$3" || bad "$3 (want $2, got $1)"; }

# Fixtures built at runtime — this file must never itself contain a secret shape.
PEM="-----BEGIN $(printf 'OPENSSH') PRIVATE KEY-----"
GHT="ghp_$(printf 'A1b2C3d4E5f6G7h8I9j0K1l2')"
# Every high-signal fixture is assembled at runtime: this file is scanned by the
# gate like any other, and a literal one would make the suite un-committable.
AWSK="AKIA$(printf '0123456789ABCDEF')"
SLACKT="xoxb-$(printf '0123456789-abcdefghij')"
JWT="eyJ$(printf 'hbGciOiJIUzI1NiJ9').eyJ$(printf 'zdWIiOiIxMjM0NTY3ODkwIn0').$(printf 'dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk')"

git init -q -b main; git config user.name t; git config user.email t@t
git config commit.gpgsign false
mkdir -p gates docs
cp "$here"/pre-commit "$here"/commit-msg "$here"/xx-wallet-boundary "$here"/t2-paths gates/
chmod +x gates/pre-commit gates/commit-msg gates/xx-wallet-boundary
# The real repo has docs/GAP_REPORT.md; without it every run prints the advisory.
: > docs/GAP_REPORT.md
# It also ships .gitleaks.toml, whose allowlist covers a known false positive in
# src/keyring/. Without a copy here this suite fails on a machine that happens
# to have gitleaks installed — a property of the harness, not of the gate.
[ -f "$here/../.gitleaks.toml" ] && cp "$here/../.gitleaks.toml" .
# The "gitleaks is not installed" case must not find a real one on the caller's
# PATH, or it tests nothing on a developer machine that has it.
MINPATH="/usr/bin:/bin"
git add -A; git commit -q --no-verify -m init
INIT="$(git rev-parse HEAD)"   # every case resets here, so no case leaks into the next

fresh(){ git reset -q --hard "$INIT"; git clean -fdq
         git config --unset diff.external 2>/dev/null || true
         git config --unset diff.algorithm 2>/dev/null || true
         rm -f .gitattributes; }
# ":(literal)" so ':x.ts' and 'a[0].ts' stage as named rather than as pathspec magic.
stage(){ mkdir -p "$(dirname "$1")"; printf '%s\n' "$2" > "$1"; git add -- ":(literal)$1"; }
pc(){ gates/pre-commit >/dev/null 2>&1; echo $?; }
# Capture, never pipe: `bd | grep -q` would SIGPIPE the gate on early exit and
# pipefail would then report the match as a failure.
bd(){ out="$(gates/xx-wallet-boundary 2>&1)"; }
has(){ printf '%s' "$out" | grep -q -- "$1"; }
cm(){ printf '%s\n' "$2" > msg.txt; gates/commit-msg msg.txt >/dev/null 2>&1; echo $?; }

echo "== secret scan: must BLOCK (rc 1) =="
# Only the high-signal shapes now. The keyword heuristic was removed (ADR-0017):
# four review rounds each proved it either blocked real code or missed a real
# secret, and gitleaks does this job properly.
for line in "$PEM" "const t = \"$GHT\";" "$AWSK" "$SLACKT" "const jwt = '$JWT';"; do
  fresh; stage xx-wallet-mobile/src/a.ts "$line"; check "$(pc)" 1 "block: ${line:0:46}"
done

echo "== secret scan: must stay CLEAN (rc 0) — false positives are not overridable, so they matter =="
# Everything the removed heuristic used to argue about now passes, by design.
for line in 'const tokenCount = computeTokens(input);' 'token: t' \
            'const SECRET_KEY = process.env.SECRET_KEY;' 'const secretStart = PKCS8_HEADER.length;' \
            'password: signerIsLedger ? undefined : password,' 'const secret = generateStorageSecret();' \
            "autoComplete={isFirstTime ? 'new-password' : 'current-password'}" \
            'POSTGRES_PASSWORD: changeme-in-production' 'DB_PASSWORD=please-set-a-real-value'; do
  fresh; stage xx-wallet-mobile/src/a.ts "$line"; check "$(pc)" 0 "clean: ${line:0:46}"
done

echo "== secret scan: fail-open bypasses (kit defects 1 and 3) =="
fresh; stage creds.env "const t = \"$GHT\";"; printf '*.env -diff\n' > .gitattributes; git add .gitattributes
check "$(pc)" 1 ".gitattributes -diff cannot hide a staged secret"
fresh; stage creds.env "const t = \"$GHT\";"; printf '*.env binary\n' > .gitattributes; git add .gitattributes
check "$(pc)" 1 ".gitattributes binary cannot hide a staged secret"
fresh; printf '#!/bin/sh\nexit 0\n' > "$T/noop"; chmod +x "$T/noop"; git config diff.external "$T/noop"
stage xx-wallet-mobile/src/a.ts "const t = \"$GHT\";"
check "$(pc)" 1 "diff.external cannot blank the scan"
fresh; stage xx-wallet-mobile/src/a.ts "++const t = \"$GHT\";"; check "$(pc)" 1 "added line starting with ++ is still scanned"
fresh; stage xx-wallet-mobile/src/a.ts "++ const t = \"$GHT\";"; check "$(pc)" 1 "added line starting with '++ ' is still scanned"

echo "== secret scan: NUL bytes must not silence the scan (kit defect 3) =="
fresh; stage xx-wallet-mobile/src/a.ts "const t = \"$GHT\";"
head -c 300 /dev/urandom | tr '\n' 'x' > logo.png; printf '\0\0' >> logo.png; git add logo.png
check "$(pc)" 1 "a PNG (NULs) staged next to a secret does not blank the scan"
fresh; mkdir -p xx-wallet-mobile/src
{ printf 'x\0y\n'; printf 'const t = "%s";\n' "$GHT"; } > xx-wallet-mobile/src/a.ts; git add xx-wallet-mobile/src/a.ts
check "$(pc)" 1 "a NUL inside the same file as the secret still blocks"

echo "== secret scan: fail-open on large input / git failure (kit defects 4 and 5) =="
fresh; stage .env "const t = \"$GHT\";"; head -c 300000 /dev/urandom | base64 > zz_big.txt; git add zz_big.txt
check "$(pc)" 1 "a ~400 KB clean file staged after the secret does not SIGPIPE the scan open"
fresh; stage .env "const t = \"$GHT\";"; head -c 3000000 /dev/urandom > zz_big.bin; git add zz_big.bin
check "$(pc)" 1 "a 3 MB binary staged after the secret does not SIGPIPE the scan open"
fresh; stage .env "const t = \"$GHT\";"; head -c 100000 /dev/urandom | base64 > zz_big.txt; git add zz_big.txt
( ulimit -f 1; gates/pre-commit >/dev/null 2>&1 ); check $? 1 "with file creation impossible (ulimit -f 1, i.e. a full /tmp) a >64 KB scan still BLOCKS"
fresh; git config diff.algorithm bogus; stage xx-wallet-mobile/src/a.ts "const t = \"$GHT\";"
check "$(pc)" 1 "a broken diff.* setting BLOCKS instead of blanking the scan"
fresh; git config diff.algorithm bogus; stage xx-wallet-mobile/src/a.ts "const x = 1;"
check "$(pc)" 1 "a broken diff.* setting blocks even a clean commit (fail closed, loudly)"
fresh; stage xx-wallet-mobile/src/a.ts "const t = \"$GHT\";"; git commit -q --no-verify -m leak
git rm -q xx-wallet-mobile/src/a.ts
check "$(pc)" 0 "REMOVING a secret is allowed (remediation must stay possible)"
# ...and with gitleaks in play too. A shim that flags its stdin the way gitleaks
# does — with no diff awareness — proves the gate feeds it ADDED lines only.
# Piping the raw diff blocked the commit that deletes a secret, which is the
# remediation for the exact problem this gate exists to prevent.
mkdir -p "$SHIMDIR/gl3"
cat > "$SHIMDIR/gl3/gitleaks" <<'GL'
#!/bin/sh
# Like gitleaks --pipe: matches content, with no idea which lines were removed.
if timeout 5 grep -q 'SENTINEL_LEAK' 2>/dev/null; then exit 1; fi
exit 0
GL
chmod +x "$SHIMDIR/gl3/gitleaks"
fresh; stage xx-wallet-mobile/src/b.ts 'const t = "SENTINEL_LEAK";'
rc=$(PATH="$SHIMDIR/gl3:$PATH" gates/pre-commit >/dev/null 2>&1; echo $?)
check "$rc" 1 "gitleaks still sees an ADDED secret"
git commit -q --no-verify -m leak2
git rm -q xx-wallet-mobile/src/b.ts
rc=$(PATH="$SHIMDIR/gl3:$PATH" gates/pre-commit >/dev/null 2>&1; echo $?)
check "$rc" 0 "REMOVING that secret is allowed even with gitleaks in play"
rm -rf "$SHIMDIR/gl3"

echo "== secret scan: a failing filter STAGE must block, not be masked by pipefail =="
# bash reports the rightmost non-zero status of a pipeline, so a stage-1 grep
# that dies with rc 2 is hidden behind stage 2's ordinary rc 1 "no match". The
# shim makes the FIRST grep invocation fail; the gate must block, not scan an
# empty string and exit 0.
fresh; stage xx-wallet-mobile/src/a.ts "const t = \"$GHT\";"
mkdir -p "$T/shim"
cat > "$T/shim/grep" <<'SHIM'
#!/bin/sh
if [ ! -e "$SHIM_STATE" ]; then : > "$SHIM_STATE"; exit 2; fi
exec /usr/bin/grep "$@"
SHIM
chmod +x "$T/shim/grep"
rm -f "$T/shim.state"
rc=$(SHIM_STATE="$T/shim.state" PATH="$T/shim:$PATH" gates/pre-commit >/dev/null 2>&1; echo $?)
check "$rc" 1 "a filter stage failing with rc 2 BLOCKS (not masked by pipefail)"
rm -rf "$T/shim" "$T/shim.state"

echo "== boundary gate: a staged deletion is not 'unverified' =="
fresh; stage xx-wallet-mobile/src/screens/Old.tsx "export const x = 1;"
git commit -q --no-verify -m to-be-deleted
git rm -q xx-wallet-mobile/src/screens/Old.tsx
XXWALLET_BOUNDARY_STRICT=1 gates/xx-wallet-boundary >/dev/null 2>&1
check $? 0 "STRICT does not flag a plain git rm of a .tsx file"
fresh

echo "== boundary gate: the T2 advisory lists one file per line =="
fresh; stage xx-wallet-mobile/src/keyring/a.ts 'export const a = 1;'; stage xx-wallet-mobile/src/ledger/b.ts 'export const b = 1;'
bd
lines=$(printf '%s' "$out" | grep -c 'xx-wallet-mobile/src/\(keyring\|ledger\)/')
check "$lines" 2 "two T2 files are listed on two separate lines"

echo "== boundary gate: a failing grep must not silently pass (ADR-0017 finding 1) =="
# The CI invocation is `--tree` with STRICT=1. A chained-grep filter would let a
# single failing grep return rc 0 with no output, with a real violation staged.
mkdir -p "$T/shim"
cat > "$T/shim/grep" <<'SHIM'
#!/bin/sh
if [ ! -e "$SHIM_STATE" ]; then : > "$SHIM_STATE"; exit 2; fi
exec /usr/bin/grep "$@"
SHIM
chmod +x "$T/shim/grep"
shimmed() {   # run the boundary gate with the first grep call failing
  rm -f "$T/shim.state"
  SHIM_STATE="$T/shim.state" PATH="$T/shim:$PATH" XXWALLET_BOUNDARY_STRICT=1 \
    gates/xx-wallet-boundary ${1:+"$1"} >/dev/null 2>&1; echo $?
}
# staged mode: the violation is STAGED, not committed
fresh; stage xx-wallet-mobile/src/screens/Send.tsx "import { Keyring } from '@polkadot/keyring';"
check "$(shimmed)" 1 "STRICT staged mode still fails with a violation when a grep dies"
# --tree mode scans tracked files, so the violation must be committed
git commit -q --no-verify -m boundary-fixture
check "$(shimmed --tree)" 1 "STRICT --tree mode still fails with a violation when a grep dies"
# and with no shim, --tree still catches it normally
XXWALLET_BOUNDARY_STRICT=1 gates/xx-wallet-boundary --tree >/dev/null 2>&1
check $? 1 "…and --tree catches the same violation with no shim"
rm -rf "$T/shim" "$T/shim.state"
fresh

echo "== the gate scans the WHOLE repo, whatever directory it is run from =="
# `gitleaks protect --staged` defaults --source to the process's cwd, so a gate
# invoked from a subdirectory used to scan only that subtree and exit 0 with a
# staged secret elsewhere. git commit always runs hooks from the root, but this
# script is invoked directly too — including by this suite.
mkdir -p "$SHIMDIR/gl2"
cat > "$SHIMDIR/gl2/gitleaks" <<'GL'
#!/bin/sh
# Records what it was actually handed: the stdin it received and its cwd.
# `timeout` and </dev/null-safe: a variant that does NOT pipe to gitleaks would
# otherwise leave this blocked on an inherited stdin and hang the whole suite.
: > "$GL_STDIN_LOG"
timeout 5 cat > "$GL_STDIN_LOG" 2>/dev/null || :
pwd > "$GL_CWD_LOG"
exit 0
GL
chmod +x "$SHIMDIR/gl2/gitleaks"
export GL_STDIN_LOG="$SHIMDIR/glin" GL_CWD_LOG="$SHIMDIR/glcwd"

# Run from a subdirectory: the gate must still be at the repo root, and must
# hand gitleaks the whole staged diff rather than letting it scope itself.
fresh; stage xx-wallet-mobile/src/deep/a.ts 'export const marker = "SENTINEL_AAA";'
rm -f "$GL_STDIN_LOG" "$GL_CWD_LOG"
( cd xx-wallet-mobile/src && PATH="$SHIMDIR/gl2:$PATH" ../../gates/pre-commit >/dev/null 2>&1 )
check "$(cat "$GL_CWD_LOG" 2>/dev/null)" "$T" "the gate runs from the repo root even when invoked from a subdirectory"
command grep -q 'SENTINEL_AAA' "$GL_STDIN_LOG" 2>/dev/null \
  && ok "gitleaks is handed the staged diff, not left to find it" \
  || bad "gitleaks did not receive the staged content"

# The finding that mattered: `.gitattributes -diff` makes gitleaks' OWN diffing
# skip a file silently. Feeding it this gate's hardened diff means the content
# reaches it anyway.
fresh; stage xx-wallet-mobile/src/keyring/secret.txt 'const hook = "SENTINEL_BBB";'
printf 'xx-wallet-mobile/src/keyring/secret.txt -diff\n' > .gitattributes; git add .gitattributes
rm -f "$GL_STDIN_LOG"
PATH="$SHIMDIR/gl2:$PATH" gates/pre-commit >/dev/null 2>&1
command grep -q 'SENTINEL_BBB' "$GL_STDIN_LOG" 2>/dev/null \
  && ok "a .gitattributes -diff file still reaches gitleaks" \
  || bad "a .gitattributes -diff file was hidden from gitleaks"

fresh; stage xx-wallet-mobile/src/keyring/secret.txt 'const hook = "SENTINEL_CCC";'
printf 'xx-wallet-mobile/src/keyring/secret.txt binary\n' > .gitattributes; git add .gitattributes
rm -f "$GL_STDIN_LOG"
PATH="$SHIMDIR/gl2:$PATH" gates/pre-commit >/dev/null 2>&1
command grep -q 'SENTINEL_CCC' "$GL_STDIN_LOG" 2>/dev/null \
  && ok "a .gitattributes binary file still reaches gitleaks" \
  || bad "a .gitattributes binary file was hidden from gitleaks"

# And a secret outside the invoking subdirectory still blocks on the local
# patterns alone, with no gitleaks at all.
fresh; stage rootlevel.txt "$PEM"
rc=$( mkdir -p xx-wallet-mobile; cd xx-wallet-mobile; ../gates/pre-commit >/dev/null 2>&1; echo $? )
check "$rc" 1 "a secret outside the invoking subdirectory still BLOCKS"

unset GL_STDIN_LOG GL_CWD_LOG
rm -rf "$SHIMDIR/gl2"
fresh

echo "== gitleaks: used when installed, and its failure is not tolerated =="
# The keyword heuristic was removed (ADR-0017); gitleaks is what now decides
# "identifier or credential". It is optional locally, so all three of its
# outcomes have to behave.
mkdir -p "$SHIMDIR/gl"
mkgl() { printf '#!/bin/sh\nexit %s\n' "$1" > "$SHIMDIR/gl/gitleaks"; chmod +x "$SHIMDIR/gl/gitleaks"; }
glrun() { PATH="$SHIMDIR/gl:$PATH" gates/pre-commit >/dev/null 2>&1; echo $?; }
fresh; stage xx-wallet-mobile/src/a.ts 'export const x = 1;'
mkgl 0; check "$(glrun)" 0 "gitleaks clean lets the commit through"
mkgl 1; check "$(glrun)" 1 "gitleaks finding a secret BLOCKS"
mkgl 2; check "$(glrun)" 1 "gitleaks failing to run BLOCKS (not treated as clean)"
mkgl 99; check "$(glrun)" 1 "an unexpected gitleaks status BLOCKS"
rm -rf "$SHIMDIR/gl"
# Absent: the gate still runs, and says so rather than implying full coverage.
fresh; stage xx-wallet-mobile/src/a.ts 'export const x = 1;'
out="$(PATH="$MINPATH" gates/pre-commit 2>&1)"; rc=$?
if [ "$rc" = "0" ] && printf '%s' "$out" | grep -q 'gitleaks is not installed'; then
  ok "without gitleaks the gate passes but says what did NOT run"
else
  bad "without gitleaks: rc=$rc, expected a pass and a notice"
fi

echo "== boundary gate --tree: a file it cannot read is UNVERIFIED, never clean =="
# The CI-enforced path. Previously untested.
fresh; stage xx-wallet-mobile/src/screens/Send.tsx "import { Keyring } from '@polkadot/keyring';"
git commit -q --no-verify -m unreadable-fixture
chmod 000 xx-wallet-mobile/src/screens/Send.tsx
out="$(XXWALLET_BOUNDARY_STRICT=1 gates/xx-wallet-boundary --tree 2>&1)"; rc=$?
chmod 644 xx-wallet-mobile/src/screens/Send.tsx
if [ "$rc" = "1" ] && printf '%s' "$out" | grep -q 'UNVERIFIED'; then
  ok "--tree STRICT reports an unreadable file as UNVERIFIED and fails"
else
  bad "--tree STRICT on an unreadable file: rc=$rc out=${out:0:60}"
fi
fresh

echo "== boundary gate: THE RULE facet (b) — keyring isolation (ADR-0003) =="
fresh; stage xx-wallet-mobile/src/screens/Send.tsx "import { Keyring } from '@polkadot/keyring';"
bd; has 'BOUNDARY: @polkadot/keyring' && ok "value import of @polkadot/keyring outside src/keyring/ is flagged" || bad "value import of @polkadot/keyring outside src/keyring/ is flagged"
fresh; stage xx-wallet-mobile/src/keyring/store.ts "import { Keyring } from '@polkadot/keyring';"
bd; has 'BOUNDARY: @polkadot/keyring' && bad "import INSIDE src/keyring/ must not be flagged" || ok "import INSIDE src/keyring/ must not be flagged"
fresh; stage xx-wallet-mobile/src/screens/Send.tsx "import type { KeyringPair } from '@polkadot/keyring';"
bd; has 'BOUNDARY: @polkadot/keyring' && bad "type-only import must not be flagged" || ok "type-only import must not be flagged"
fresh; stage xx-wallet-mobile/src/screens/Send.tsx "xxKeyring.unlock(password);"
bd; has 'BOUNDARY: xxKeyring.unlock' && ok "xxKeyring.unlock( outside the boundary is flagged (AUDIT-2026-07-002)" || bad "xxKeyring.unlock( outside the boundary is flagged (AUDIT-2026-07-002)"
fresh; stage xx-wallet-mobile/src/hooks/useTxSubmit.ts "xxKeyring.unlock(password);"
bd; has 'BOUNDARY: xxKeyring.unlock' && bad "unlock( inside a useTx hook must not be flagged" || ok "unlock( inside a useTx hook must not be flagged"
fresh; stage xx-wallet-mobile/src/components/Note.tsx "<div dangerouslySetInnerHTML={{ __html: memo }} />"
bd; has 'dangerouslySetInnerHTML' && ok "dangerouslySetInnerHTML is flagged (ADR-0002, text-only surfaces)" || bad "dangerouslySetInnerHTML is flagged (ADR-0002, text-only surfaces)"

echo "== boundary gate: filenames, strict mode, T2 advisory =="
fresh; stage 'xx-wallet-mobile/src/my screen.tsx' "import { Keyring } from '@polkadot/keyring';"
bd; has 'BOUNDARY: @polkadot/keyring' && ok "filename with a space is scanned" || bad "filename with a space is scanned"
fresh; stage 'xx-wallet-mobile/src/a[0].tsx' "import { Keyring } from '@polkadot/keyring';"; stage xx-wallet-mobile/src/a0.tsx 'export const x = 1;'
bd; has 'a\[0\].tsx' && ok "glob-metachar filename is scanned, not a decoy" || bad "glob-metachar filename is scanned, not a decoy"
fresh; stage xx-wallet-mobile/src/keyring/store.ts 'export const x = 1;'
bd; has 'T2-area files' && ok "T2 tier-map touch prints the advisory" || bad "T2 tier-map touch prints the advisory"
fresh; stage xx-wallet-mobile/src/screens/Send.tsx "import { Keyring } from '@polkadot/keyring';"
XXWALLET_BOUNDARY_STRICT=1 gates/xx-wallet-boundary >/dev/null 2>&1; check $? 1 "STRICT=1 fails on a violation"
gates/xx-wallet-boundary >/dev/null 2>&1; check $? 0 "…and advisory mode still exits 0"
fresh; stage xx-wallet-mobile/src/screens/Send.tsx "import { Keyring } from '@polkadot/keyring';"
( cd xx-wallet-mobile/src || exit 99; XXWALLET_BOUNDARY_STRICT=1 ../../gates/xx-wallet-boundary >/dev/null 2>&1 )
check $? 1 "STRICT still fails when invoked from a subdirectory"

echo "== commit-msg: tier trailers on code commits =="
fresh; stage xx-wallet-mobile/src/a.ts 'export const x = 1;'
check "$(cm _ 'chore: a code change with no trailer')" 1 "code commit without Tier: is blocked"
check "$(cm _ 'chore: routine

Tier: T0')" 0 "Tier: T0 alone is enough for a routine change"
check "$(cm _ 'feat: boundary work

Tier: T1
Review: self
ADR: none')" 1 "T1 with 'Review: self' is blocked (the builder does not grade its own homework)"
check "$(cm _ 'feat: boundary work

Tier: T1
Review: independent
ADR: none')" 0 "T1 with independent review + ADR: none passes"
check "$(cm _ 'fix: keyring

Tier: T2
Review: independent
ADR: none')" 1 "T2 without a Non-AI-Check: trailer is blocked"
check "$(cm _ 'fix: keyring

Tier: T2
Review: independent
ADR: none
Non-AI-Check: test-vectors')" 0 "T2 with a recorded non-AI check passes"
fresh; stage docs/NOTES.md 'notes'
check "$(cm _ 'docs: notes')" 0 "docs-only commit needs no classification"

echo ""
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ] || exit 1
