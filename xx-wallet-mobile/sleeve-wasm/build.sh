#!/usr/bin/env bash
#
# Build the Sleeve WASM module and stage it into ../public/sleeve/
# alongside the Go-runtime helper (wasm_exec.js).
#
# Usage: ./build.sh   (from inside sleeve-wasm/)
#
# This script is only needed when changing the Go source. Day-to-day
# `npm run build` does not invoke this — it consumes the prebuilt
# ../public/sleeve/main.wasm + wasm_exec.js artifacts that are committed
# to the repo.

set -euo pipefail

cd "$(dirname "$0")"

# 1. Resolve and download Go deps. First run will fetch xx-labs/sleeve.
echo "==> Resolving Go dependencies..."
go mod tidy

# 2. Find Go's wasm_exec.js. Location moved between Go versions:
#    Go ≤1.20: $GOROOT/misc/wasm/wasm_exec.js
#    Go ≥1.21: $GOROOT/lib/wasm/wasm_exec.js (renamed/moved)
GOROOT="$(go env GOROOT)"
WASM_EXEC=""
for candidate in \
    "$GOROOT/lib/wasm/wasm_exec.js" \
    "$GOROOT/misc/wasm/wasm_exec.js"; do
    if [ -f "$candidate" ]; then
        WASM_EXEC="$candidate"
        break
    fi
done

if [ -z "$WASM_EXEC" ]; then
    echo "ERROR: couldn't find wasm_exec.js in Go installation at $GOROOT" >&2
    echo "Expected at one of: lib/wasm/wasm_exec.js or misc/wasm/wasm_exec.js" >&2
    exit 1
fi

# 3. Make the staging directory.
TARGET_DIR="../public/sleeve"
mkdir -p "$TARGET_DIR"

# 4. Copy the runtime helper. This file lets the browser load Go-WASM modules.
echo "==> Copying wasm_exec.js from $WASM_EXEC"
cp "$WASM_EXEC" "$TARGET_DIR/wasm_exec.js"

# 5. Compile our Go entry point to WASM.
echo "==> Building main.wasm..."
GOOS=js GOARCH=wasm go build -o "$TARGET_DIR/main.wasm" .

# 6. Report sizes so we know what we just shipped.
echo ""
echo "==> Built artifacts (in $TARGET_DIR):"
ls -lh "$TARGET_DIR"
echo ""
echo "Done. The wallet's TS wrapper at src/keyring/sleeve.ts will load these."
