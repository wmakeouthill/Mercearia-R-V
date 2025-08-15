#!/usr/bin/env bash
set -euo pipefail

# Usage: sudo ./setup_nginx_certbot.sh /path/to/frontend/dist
# This script assumes a Debian/Ubuntu system with apt

FRONTEND_DIST=${1:-}
if [ -z "$FRONTEND_DIST" ]; then
  echo "Usage: sudo $0 /path/to/frontend/dist"
  exit 2
fi

echo "Installing nginx and certbot..."
apt update
apt install -y nginx certbot python3-certbot-nginx

echo "Creating web root and copying frontend files..."
mkdir -p /var/www/merceariarv.app
rm -rf /var/www/merceariarv.app/*
cp -r "$FRONTEND_DIST"/* /var/www/merceariarv.app/
chown -R www-data:www-data /var/www/merceariarv.app

echo "Installing nginx site config..."
cp ../nginx/merceariarv.app.conf /etc/nginx/sites-available/merceariarv.app
ln -sf /etc/nginx/sites-available/merceariarv.app /etc/nginx/sites-enabled/merceariarv.app
nginx -t
systemctl reload nginx

echo "Requesting Let's Encrypt certificate via certbot..."
certbot --nginx -d merceariarv.app -d www.merceariarv.app --non-interactive --agree-tos -m you@example.com

echo "Done. Test renewal: sudo certbot renew --dry-run"


