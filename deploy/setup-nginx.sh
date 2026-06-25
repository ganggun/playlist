#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-supdobby.me}"
PUBLIC_SSL_PORT="${PUBLIC_SSL_PORT:-9513}"
NGINX_SSL_PORT="${NGINX_SSL_PORT:-8082}"
APP_HOST_PORT="${APP_HOST_PORT:-19520}"
CERT_PATH="${CERT_PATH:-/etc/letsencrypt/live/${DOMAIN}/fullchain.pem}"
KEY_PATH="${KEY_PATH:-/etc/letsencrypt/live/${DOMAIN}/privkey.pem}"
SITE_PATH="/etc/nginx/sites-available/playlist-request.conf"

sudo tee "$SITE_PATH" >/dev/null <<NGINX
server {
    listen ${NGINX_SSL_PORT} ssl;
    server_name ${DOMAIN};

    ssl_certificate ${CERT_PATH};
    ssl_certificate_key ${KEY_PATH};

    location / {
        proxy_pass http://127.0.0.1:${APP_HOST_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
NGINX

sudo ln -sf "$SITE_PATH" /etc/nginx/sites-enabled/playlist-request.conf
sudo nginx -t
sudo systemctl reload nginx

echo "nginx proxy ready: https://${DOMAIN}:${PUBLIC_SSL_PORT}"
