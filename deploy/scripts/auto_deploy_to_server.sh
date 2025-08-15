#!/usr/bin/env bash
set -euo pipefail
# Usage:
# SSH_USER=user SSH_HOST=1.2.3.4 DEST_DIR=/tmp/deploy bash auto_deploy_to_server.sh

: ${SSH_USER:?}
: ${SSH_HOST:?}
: ${DEST_DIR:=/tmp/merceariarv_deploy}

LOCAL_PACKAGE_DIR=$(dirname "$0")/../package
if [ ! -d "$LOCAL_PACKAGE_DIR" ]; then
  echo "Local deploy package not found at $LOCAL_PACKAGE_DIR. Run scripts/create-deploy-package.js first." >&2
  exit 2
fi

echo "Copying deploy package to $SSH_USER@$SSH_HOST:$DEST_DIR ..."
ssh ${SSH_USER}@${SSH_HOST} "mkdir -p ${DEST_DIR}"
scp -r ${LOCAL_PACKAGE_DIR}/* ${SSH_USER}@${SSH_HOST}:${DEST_DIR}/

echo "Executing remote deploy script..."
ssh ${SSH_USER}@${SSH_HOST} "bash -s" <<'REMOTE'
set -euo pipefail
cd ${DEST_DIR}
if [ -f deploy/scripts/deploy_lan_one_liner.sh ]; then
  sudo FRONTEND_BUILD_DIR=${DEST_DIR}/frontend BACKEND_JAR_PATH=/opt/backend/backend-spring-0.0.1-SNAPSHOT.jar bash deploy/scripts/deploy_lan_one_liner.sh
else
  echo "Remote deploy script not found" >&2
  exit 3
fi
REMOTE

echo "Remote deploy finished."


