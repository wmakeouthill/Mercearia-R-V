#!/usr/bin/env bash
set -euo pipefail

# Usage: sudo ./setup_nginx_http.sh /path/to/frontend/dist
# This script installs nginx (if missing), copies frontend build and configures
# a simple HTTP-only site for merceariarv.lan. Intended for LAN use only.

FRONTEND_DIST=${1:-}
if [ -z "$FRONTEND_DIST" ]; then
  echo "Usage: sudo $0 /path/to/frontend/dist"
  exit 2
fi

echo "Installing nginx (if needed)..."
apt update
apt install -y nginx

echo "Creating web root and copying frontend files..."
mkdir -p /var/www/merceariarv.lan
rm -rf /var/www/merceariarv.lan/*
cp -r "$FRONTEND_DIST"/* /var/www/merceariarv.lan/
chown -R www-data:www-data /var/www/merceariarv.lan

echo "Installing nginx site config for merceariarv.lan..."
cp ../nginx/merceariarv.lan.conf /etc/nginx/sites-available/merceariarv.lan
ln -sf /etc/nginx/sites-available/merceariarv.lan /etc/nginx/sites-enabled/merceariarv.lan
nginx -t
systemctl reload nginx

echo "Setup complete. Make sure clients resolve 'merceariarv.lan' to this server's LAN IP (router DNS/hosts)."


