#!/bin/bash
# Deploys the arena-crank Railway worker. The repo-root railway.json belongs
# to the WEB service (standalone Next server + healthcheck — pinned by
# lib/deploy/railway-config.test.ts); the worker needs its own config
# (railway.crank.json: no build phase, tsx start). Railway only reads the
# config file named railway.json at `up` time, so swap, deploy, restore.
set -euo pipefail
cd "$(dirname "$0")/../.."
trap 'git checkout -- railway.json' EXIT
cp railway.crank.json railway.json
railway up --service arena-crank --detach
