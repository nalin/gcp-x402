#!/usr/bin/env bash
# Copy the canonical skill into the proxy so it can be served at GET /skill.
# Run this before deploying the proxy (the Cloud Run build context is proxy/,
# which can't reach ../skill, so the copy must live inside proxy/).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/skill/bigquery-public-data/SKILL.md"
dst="$root/proxy/public/skill.md"
mkdir -p "$(dirname "$dst")"
cp "$src" "$dst"
echo "synced: $src -> $dst"
