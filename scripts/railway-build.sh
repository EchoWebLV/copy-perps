#!/usr/bin/env bash
# Railway per-service build launcher. The worker just runs tsx (deps are already
# installed by Railpack's install phase) — it must NOT run the Next.js build,
# which needs the full web env. Branch on the auto-injected service name.
set -euo pipefail

case "${RAILWAY_SERVICE_NAME:-web}" in
  arena-llm-operator)
    echo "[railway-build] worker — skipping Next build (tsx-only)"
    ;;
  *)
    echo "[railway-build] web — next build"
    npm run build
    ;;
esac
