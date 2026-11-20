#!/usr/bin/env bash
# Deploy the latest main branch to the TEST server. Run on the server.
set -euo pipefail
cd /opt/wpc && git pull --ff-only
cd backend && npm ci --omit=dev && npm run migrate
pm2 restart wpc-test --update-env
sleep 2 && curl -s http://localhost:3100/healthz && echo
