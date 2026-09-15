#!/usr/bin/env bash
# gates/test-ci-secret-scan.sh — does CI's secret scan actually see everything?
#
# The recorded non-AI check for docs/adr/0018. CI runs
#   gitleaks detect --source . --config .gitleaks.toml
# over full history, and gitleaks does its OWN diffing to walk that history.
# That diffing honours .gitattributes, so a path marked `-diff` or `binary` is
# skipped silently — no finding, no warning, exit 0. A secret committed under
# such an attribute is invisible to CI forever.
#
# This reproduces the blind spot against the exact gitleaks version CI pins, and
# proves the fix (`printf '* diff' > .git/info/attributes`) closes it. It builds
# throwaway repositories under $TMPDIR and never touches this one.
#
# Skips with exit 77 — not 0 — when gitleaks is unavailable, so a caller that
# only checks the status cannot mistake a skip for a pass.
set -uo pipefail

GITLEAKS_VERSION="${GITLEAKS_VERSION:-8.18.4}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/.." && pwd)"
base="${TMPDIR:-/tmp}"

T="$(mktemp -d "$base/ci-scan-test.XXXXXX")" || { echo "mktemp failed under $base"; exit 2; }
T="$(realpath "$T")" || exit 2
trap 'rm -rf "$T"' EXIT

# Use a gitleaks already on PATH, else the pinned release, else skip loudly.
if command -v gitleaks >/dev/null 2>&1; then
  GL="$(command -v gitleaks)"
elif command -v curl >/dev/null 2>&1 && curl -sSfL --max-time 60 \
      "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
      -o "$T/gl.tgz" 2>/dev/null && tar -xzf "$T/gl.tgz" -C "$T" gitleaks 2>/dev/null; then
  GL="$T/gitleaks"
else
  echo "test-ci-secret-scan: SKIPPED — no gitleaks available and it could not be fetched."
  echo "                     CI's secret scan is UNVERIFIED until this runs somewhere"
  echo "                     that has it. See docs/adr/0018."
  exit 77
fi
echo "using gitleaks: $("$GL" version 2>/dev/null || echo unknown)"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok    %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL  %s\n' "$1"; }

# A real secret shape gitleaks detects, and which is NOT one of the six shapes
# the local pre-commit patterns catch — so this measures gitleaks, not the
# fallback.
#
# Assembled at runtime, never written as one literal: GitHub's own push
# protection scans this file like any other and rejected the push when the
# whole URL appeared on one line. Which is the system working — but the fixture
# for a secret-scanning test cannot itself be a scannable secret. The value is
# identical once assembled, so what the test measures is unchanged.
SECRET="https://hooks.slack.com/$(printf 'services')/$(printf 'T00000000')/$(printf 'B00000000')/$(printf 'XXXXXXXXXXXXXXXXXXXXXXXX')"

# build_repo <attribute-or-empty> <override-or-empty> -> echoes the repo path
build_repo() {
  local attr="$1" override="$2" d
  d="$(mktemp -d "$T/repo.XXXXXX")"
  ( cd "$d"
    git init -q -b main
    git config user.name t; git config user.email t@t
    git config commit.gpgsign false
    [ -f "$repo_root/.gitleaks.toml" ] && cp "$repo_root/.gitleaks.toml" .
    mkdir -p xx-wallet-mobile/src/keyring
    [ -n "$attr" ] && printf 'xx-wallet-mobile/src/keyring/secret.txt %s\n' "$attr" > .gitattributes
    printf 'const hook = "%s";\n' "$SECRET" > xx-wallet-mobile/src/keyring/secret.txt
    git add -A
    git commit -q -m "a secret, committed"
    [ -n "$override" ] && printf '%s\n' "$override" > .git/info/attributes
    true
  )
  echo "$d"
}

# CI's exact invocation. 1 = leaks found, 0 = clean.
ci_scan() { ( cd "$1" && "$GL" detect --source . --config .gitleaks.toml --redact --no-banner >/dev/null 2>&1; echo $? ); }

echo "== the blind spot this change exists to close =="
for attr in '-diff' 'binary'; do
  d="$(build_repo "$attr" '')"
  rc="$(ci_scan "$d")"
  if [ "$rc" = "0" ]; then
    ok "a secret under '.gitattributes $attr' IS invisible to the unfixed scan (premise holds)"
  else
    bad "expected the unfixed scan to miss '$attr' (rc $rc) — the premise may have changed; re-read ADR-0018"
  fi
done

echo "== the fix =="
for attr in '-diff' 'binary'; do
  d="$(build_repo "$attr" '* diff')"
  rc="$(ci_scan "$d")"
  [ "$rc" = "1" ] && ok "with the override, '$attr' no longer hides the secret" \
                  || bad "the override did not restore the scan for '$attr' (rc $rc)"
done

echo "== the override changes nothing else =="
d="$(build_repo '' '* diff')"
rc="$(ci_scan "$d")"
[ "$rc" = "1" ] && ok "an ordinary committed secret is still found" \
                || bad "the override broke the normal case (rc $rc)"

d="$(mktemp -d "$T/clean.XXXXXX")"
( cd "$d"; git init -q -b main; git config user.name t; git config user.email t@t
  git config commit.gpgsign false
  [ -f "$repo_root/.gitleaks.toml" ] && cp "$repo_root/.gitleaks.toml" .
  mkdir -p src; printf 'export const x = 1;\n' > src/a.ts
  git add -A; git commit -q -m clean; printf '* diff\n' > .git/info/attributes )
rc="$(ci_scan "$d")"
[ "$rc" = "0" ] && ok "a clean repository still passes (no false positive)" \
                || bad "the override caused a false positive on a clean repo (rc $rc)"

echo "== the override cannot be switched off from inside the repository =="
# .git/info/attributes is not part of the working tree, so it cannot be changed
# by a commit or a pull request — which is what makes this a control rather
# than a convention.
d="$(build_repo '-diff' '* diff')"
( cd "$d" && printf '* -diff\n' > .gitattributes && git add -A && git commit -q -m "try to switch it off" )
rc="$(ci_scan "$d")"
[ "$rc" = "1" ] && ok "a committed .gitattributes cannot override .git/info/attributes" \
                || bad "an in-tree .gitattributes defeated the override (rc $rc)"

echo "== CI really does what this test models — by RUNNING it =="
# Not a grep over ci.yml. Substring checks on the workflow text pass against a
# commented-out override, or one redirected to the wrong path — proved by the
# review of this very change. So the step's own `run:` script is extracted and
# EXECUTED inside a throwaway repository, with only the tarball download
# replaced by the gitleaks binary already in hand. If the workflow would not
# work, this fails.
extract_step() {   # -> the Secret scan step's run: script, verbatim
  "${PYTHON:-python3}" - "$repo_root/.github/workflows/ci.yml" <<'PY'
import sys, yaml
wf = yaml.safe_load(open(sys.argv[1]))
steps = wf["jobs"]["checks"]["steps"]
hit = [s for s in steps if "secret scan" in str(s.get("name", "")).lower()]
if len(hit) != 1:
    sys.stderr.write(f"expected exactly one Secret scan step, found {len(hit)}\n"); sys.exit(2)
sys.stdout.write(hit[0].get("run", ""))
PY
}

step_rc=0
step_script="$(extract_step)" || step_rc=$?
if [ "$step_rc" -ne 0 ] || [ -z "$step_script" ]; then
  bad "could not extract the Secret scan step from ci.yml (rc $step_rc)"
else
  ok "the Secret scan step was found in ci.yml and extracted"

  # Run it for real against a repo whose secret is hidden by an attribute.
  # The download is the only substitution: no network, and the pinned binary
  # is already resolved above.
  # `set -eo pipefail`, matching GitHub Actions' real default shell for a
  # `run:` block (`bash --noprofile --norc -eo pipefail {0}`). Without -e a
  # failing line in the MIDDLE of the step is swallowed and the rest runs
  # anyway — which made this test certify a step that would abort on every real
  # CI run. Note: no -u, because Actions does not set it and a step that relies
  # on an unset variable must behave here as it would there.
  # The scanner is replaced by a WRAPPER that writes its own output to a
  # dedicated file. Nothing else in the step can write there, so the verdict
  # below comes from the scanner and only the scanner.
  #
  # Reading the step's combined output instead was the previous mistake: a
  # perfectly ordinary log line containing the words "leaks found:" — printed
  # before an abort, by a step whose scan never ran — read as a real finding.
  # Scoping by position (a sentinel, say) has the same weakness: it is still a
  # substring search over a stream anything can write to.
  GLOUT="$T/gitleaks.out"
  glwrap="$T/gl-wrapper.sh"
  cat > "$glwrap" <<WRAP
#!/bin/sh
"$GL" "\$@" > "$GLOUT" 2>&1
rc=\$?
cat "$GLOUT"
exit \$rc
WRAP
  chmod +x "$glwrap"

  runner="$T/run-step.sh"
  {
    printf '%s\n' 'set -eo pipefail'
    printf '%s\n' "$step_script" \
      | command grep -v 'curl -sSfL' \
      | sed "s#\./gitleaks#$glwrap#g"
  } > "$runner"

  # Exit status alone is not enough either: gitleaks exits 1 for "leaks found",
  # and so does sha256sum for a bad checksum, tar for a corrupt archive, and
  # most other things that could go wrong in this step. So the scanner's own
  # result line has to be present in the output. Anything that aborts the step
  # earlier produces neither line and is reported as a failure, not a finding.
  run_step() {   # $1 = repo dir -> prints "FOUND" | "CLEAN" | "BROKEN:<rc>"
    local d="$1" rc=0 gl
    rm -f "$GLOUT"                       # absent unless the scanner itself runs
    ( cd "$d" && bash "$runner" >/dev/null 2>&1 ) || rc=$?
    [ -s "$GLOUT" ] || { echo "BROKEN:$rc"; return; }
    gl="$(sed 's/\x1b\[[0-9;]*m//g' "$GLOUT")"
    if printf '%s' "$gl" | command grep -q 'leaks found:'; then echo "FOUND"
    elif printf '%s' "$gl" | command grep -q 'no leaks found'; then echo "CLEAN"
    else echo "BROKEN:$rc"; fi
  }

  for attr in '-diff' 'binary'; do
    d="$(build_repo "$attr" '')"          # NO override applied by the test
    verdict="$(run_step "$d")"
    if [ "$verdict" = "FOUND" ]; then
      ok "running ci.yml's own step catches a secret hidden by '$attr'"
    else
      bad "ci.yml's own step did not report a finding for '$attr' (got $verdict)"
    fi
    # And it must be the step that created the override, not the test.
    if [ -s "$d/.git/info/attributes" ]; then
      ok "ci.yml's own step wrote .git/info/attributes"
    else
      bad "ci.yml's own step did not write .git/info/attributes"
    fi
  done

  # A clean repository must still pass when the real step runs.
  d="$(mktemp -d "$T/wfclean.XXXXXX")"
  ( cd "$d"; git init -q -b main; git config user.name t; git config user.email t@t
    git config commit.gpgsign false
    [ -f "$repo_root/.gitleaks.toml" ] && cp "$repo_root/.gitleaks.toml" .
    mkdir -p src; printf 'export const x = 1;\n' > src/a.ts
    git add -A; git commit -q -m clean )
  verdict="$(run_step "$d")"
  [ "$verdict" = "CLEAN" ] && ok "running ci.yml's own step leaves a clean repo passing" \
                          || bad "ci.yml's own step did not report a clean scan (got $verdict)"

  # A step that aborts before the scanner runs must read as BROKEN, never as a
  # pass and never as a finding. This is what the exit-code-only check missed:
  # the project's own next planned edit to this step (a sha256sum checksum on
  # the download) exits 1 when it fails, exactly like "leaks found".
  # Two ways a step can look like it worked without the scan running. Both must
  # read as broken. The second is the one that defeated the previous version:
  # an ordinary log line that happens to contain the scanner's own wording.
  for decoy in '' 'echo "gitleaks setup: 0 leaks found: previously allowlisted entries only"'; do
    probe="$T/run-step-broken.sh"
    { printf '%s\n' 'set -eo pipefail'
      [ -n "$decoy" ] && printf '%s\n' "$decoy"
      printf '%s\n' 'echo "0000000000000000000000000000000000000000000000000000000000000000  x.tgz" | sha256sum -c -'
      sed '1d' "$runner"
    } > "$probe"
    d="$(build_repo '-diff' '')"
    rm -f "$GLOUT"
    prc=0; ( cd "$d" && bash "$probe" >/dev/null 2>&1 ) || prc=$?
    label="a step that aborts before the scan reads as broken"
    [ -n "$decoy" ] && label="$label, even when it printed the scanner's own wording first"
    if [ -s "$GLOUT" ]; then
      bad "$label (the scanner's output file was written anyway)"
    elif [ "$prc" -eq 0 ]; then
      bad "$label (it exited 0)"
    else
      ok "$label"
    fi
  done
fi

echo "== a NUL byte alone hides a secret, with no .gitattributes at all =="
# git auto-detects binary content, so a secret in a file containing a NUL byte
# is skipped by gitleaks' history walk even with no attribute set — reachable by
# anyone who can commit a file, no .gitattributes needed. The same override
# fixes it, because it forces the `diff` attribute true regardless of detection.
# Note the ORDINARY extension: gitleaks' own default allowlist skips some
# extensions outright (see ADR-0018), which would mask what this case measures.
nulrepo() {
  local d; d="$(mktemp -d "$T/nul.XXXXXX")"
  ( cd "$d"; git init -q -b main; git config user.name t; git config user.email t@t
    git config commit.gpgsign false
    [ -f "$repo_root/.gitleaks.toml" ] && cp "$repo_root/.gitleaks.toml" .
    mkdir -p src
    { printf 'x\000y\n'; printf 'const hook = "%s";\n' "$SECRET"; } > src/secret.ts
    git add -A; git commit -q -m nul ) >/dev/null 2>&1
  echo "$d"
}
d="$(nulrepo)"
rc="$(ci_scan "$d")"
[ "$rc" = "0" ] && ok "a NUL byte alone IS enough to hide a secret (premise holds)" \
                || bad "expected the unfixed scan to miss a NUL-containing file (rc $rc)"
printf '* diff\n' > "$d/.git/info/attributes"
rc="$(ci_scan "$d")"
[ "$rc" = "1" ] && ok "the override also uncovers a NUL-hidden secret" \
                || bad "the override did not uncover the NUL-hidden secret (rc $rc)"

echo "== what the override does NOT cover, stated so it is not mistaken for coverage =="
# gitleaks' own default allowlist skips certain file extensions entirely, in
# both scan modes. That is gitleaks' behaviour, not git's, and no attribute
# override reaches it. Recorded in ADR-0018 as an accepted limitation.
# Every extension the ADR names is exercised, not just one: the documented
# claim and the runnable evidence have to cover the same ground, or the doc
# goes stale unnoticed when gitleaks changes its allowlist for one of them.
for ext in bin jpg pdf zip exe; do
  d="$(mktemp -d "$T/ext.XXXXXX")"
  ( cd "$d"; git init -q -b main; git config user.name t; git config user.email t@t
    git config commit.gpgsign false
    [ -f "$repo_root/.gitleaks.toml" ] && cp "$repo_root/.gitleaks.toml" .
    mkdir -p src; printf 'const hook = "%s";\n' "$SECRET" > "src/secret.$ext"
    git add -A; git commit -q -m ext; printf '* diff\n' > .git/info/attributes ) >/dev/null 2>&1
  rc="$(ci_scan "$d")"
  if [ "$rc" = "0" ]; then
    ok ".$ext is still skipped by gitleaks itself, override or not (known limit)"
  else
    bad ".$ext is now scanned (rc $rc) — gitleaks changed; ADR-0018's limitation note is stale"
  fi
done
# Controls: an ordinary extension must still be scanned, or the case above is
# measuring nothing.
for ext in ts txt; do
  d="$(mktemp -d "$T/ctl.XXXXXX")"
  ( cd "$d"; git init -q -b main; git config user.name t; git config user.email t@t
    git config commit.gpgsign false
    [ -f "$repo_root/.gitleaks.toml" ] && cp "$repo_root/.gitleaks.toml" .
    mkdir -p src; printf 'const hook = "%s";\n' "$SECRET" > "src/secret.$ext"
    git add -A; git commit -q -m ctl ) >/dev/null 2>&1
  rc="$(ci_scan "$d")"
  [ "$rc" = "1" ] && ok "control: .$ext IS scanned, so the limit above is real and narrow" \
                  || bad "control: .$ext was not scanned (rc $rc) — the extension cases prove nothing"
done

echo
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ] || exit 1
