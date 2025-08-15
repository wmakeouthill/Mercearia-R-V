#!/usr/bin/env bash
set -euo pipefail
# deploy_lan_one_liner.sh
# Run on the server (Ubuntu/Debian). Expects that:
# - frontend build (browser) is available at FRONTEND_BUILD_DIR
# - backend jar is available at BACKEND_JAR_PATH
# Usage (example):
# sudo FRONTEND_BUILD_DIR=/tmp/browser BACKEND_JAR_PATH=/tmp/backend-spring-0.0.1-SNAPSHOT.jar bash deploy_lan_one_liner.sh

: ${FRONTEND_BUILD_DIR:?Need to set FRONTEND_BUILD_DIR}
: ${BACKEND_JAR_PATH:?Need to set BACKEND_JAR_PATH}

echo "1) Install nginx"
apt update
apt install -y nginx

echo "2) Install frontend into /var/www/merceariarv.lan"
rm -rf /var/www/merceariarv.lan
mkdir -p /var/www/merceariarv.lan
cp -r "$FRONTEND_BUILD_DIR"/* /var/www/merceariarv.lan/
chown -R www-data:www-data /var/www/merceariarv.lan

echo "3) Install nginx site config"
mkdir -p /etc/nginx/sites-available
cp -f $(dirname "$0")/../nginx/merceariarv.lan.conf /etc/nginx/sites-available/merceariarv.lan
ln -sf /etc/nginx/sites-available/merceariarv.lan /etc/nginx/sites-enabled/merceariarv.lan
nginx -t
systemctl reload nginx

echo "4) Deploy backend jar to /opt/backend"
mkdir -p /opt/backend
cp -f "$BACKEND_JAR_PATH" /opt/backend/
chown -R www-data:www-data /opt/backend

echo "5) Install systemd unit and start backend service"
cp -f $(dirname "$0")/../systemd/backend-spring.service /etc/systemd/system/backend-spring.service
systemctl daemon-reload
systemctl enable --now backend-spring

echo "6) Install and configure mDNS (Avahi) for local discovery"
apt install -y avahi-daemon
mkdir -p /etc/avahi/services
cp -f $(dirname "$0")/../avahi/merceariarv.service /etc/avahi/services/merceariarv.service
systemctl restart avahi-daemon || true

# determine server LAN IP (first non-loopback IPv4)
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -z "$SERVER_IP" ]; then
  # fallback to ip route
  SERVER_IP=$(ip route get 8.8.8.8 2>/dev/null | awk '/src/ {print $7; exit}')
fi
echo "Server LAN IP detected: $SERVER_IP"

echo "7) Generate QR code pointing to http://$SERVER_IP/"
mkdir -p /var/www/merceariarv.lan
$(dirname "$0")/generate_qr.sh "$SERVER_IP" /var/www/merceariarv.lan || true
if [ -f /var/www/merceariarv.lan/merceariarv_qr.png ]; then
  echo "QR code available at: http://$SERVER_IP/merceariarv_qr.png"
  cp -f /var/www/merceariarv.lan/merceariarv_qr.png /var/www/merceariarv.lan/merceariarv_qr.png
fi

echo "6) Done. Verify:"
echo "  - sudo systemctl status nginx"
echo "  - sudo systemctl status backend-spring"
echo "  - curl -I http://$SERVER_IP/"
echo "  - curl -I http://$SERVER_IP/api/health"


