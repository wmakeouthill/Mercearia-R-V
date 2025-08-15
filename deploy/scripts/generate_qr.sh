#!/usr/bin/env bash
set -euo pipefail
# Usage: sudo ./generate_qr.sh 192.168.1.42 /var/www/merceariarv.lan
SERVER_IP=${1:-}
OUT_DIR=${2:-/tmp}
if [ -z "$SERVER_IP" ]; then
  echo "Usage: $0 <server-ip> [out-dir]" >&2
  exit 2
fi
URL="http://$SERVER_IP/"
OUT_PNG="$OUT_DIR/merceariarv_qr.png"
echo "Generating QR for $URL -> $OUT_PNG"
apt-get update -y
apt-get install -y qrencode >/dev/null 2>&1 || true
if command -v qrencode >/dev/null 2>&1; then
  qrencode -o "$OUT_PNG" -s 6 "$URL"
  echo "$OUT_PNG"
else
  # fallback: create a tiny html with data URL using node if available
  if command -v node >/dev/null 2>&1; then
    node -e "const qr=require('qrcode'); qr.toFile('$OUT_PNG','$URL',{width:300},(e)=>{if(e){console.error(e);process.exit(2)}else console.log('$OUT_PNG')});"
  else
    echo "qrencode and node not available; cannot generate QR" >&2
    exit 3
  fi
fi


