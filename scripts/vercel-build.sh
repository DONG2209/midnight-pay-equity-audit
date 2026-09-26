#!/usr/bin/env bash
# Build script for Vercel (see vercel.json / frontend/vercel.json). Resolves
# paths from this script's own location rather than $PWD, so it works whether
# Vercel's "Root Directory" ends up set to the repo root (cwd here is the repo
# root) or to frontend/ (cwd here is frontend/) — Vercel's monorepo auto-
# detection has been observed to pick either.
#
# Vercel's build image doesn't ship the Compact compiler, so this installs it
# fresh on every build — the same install command used in
# .github/workflows/level4-ci.yml — then compiles the contract and builds the
# static frontend.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "==> Installing the Compact developer tools"
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
export PATH="$HOME/.local/bin:$PATH"
compact update 0.34.0

echo "==> Compiling the Compact contract"
npm --prefix "$REPO_ROOT/contract" run compact

echo "==> Building the frontend"
npm --prefix "$REPO_ROOT/frontend" run build
