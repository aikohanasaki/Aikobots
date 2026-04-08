#!/usr/bin/env bash
set -euo pipefail
cd /srv/aikobots
export NODE_ENV=production
node server.js
