#!/usr/bin/env bash
set -euo pipefail

echo "== docker containers =="
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

echo
echo "== listening sockets =="
ss -tulpn | awk 'NR==1 || /LISTEN/'

echo
echo "== nginx enabled sites =="
ls -la /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null || true

