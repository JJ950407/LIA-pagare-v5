#!/usr/bin/env bash
set -euo pipefail

USER_HOST="${1:-root@38.242.222.25}"
PROC="${2:-lia-pagare}"                 # nombre del proceso en PM2
BASE="/opt/lia-pagare-v3"               # base de despliegue en el SERVER
RELEASE_TS="$(date +%Y%m%d%H%M%S)"
RELEASE_DIR="$BASE/releases/$RELEASE_TS"

echo "→ Deploy a $USER_HOST | release $RELEASE_TS"

# 1) Estructura base en el SERVER
ssh "$USER_HOST" "mkdir -p $BASE/releases $BASE/shared/.wwebjs_auth $BASE/shared/logs"

# 2) Subir código al release NUEVO (sin node_modules ni .git)
rsync -avz --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude ".DS_Store" \
  ./ "$USER_HOST:$RELEASE_DIR/"

# 3) Instalar dependencias en el SERVER
ssh "$USER_HOST" "cd $RELEASE_DIR && npm i --production"

# 4) Enlazar .env y sesión WA desde shared/
ssh "$USER_HOST" "\
  ln -sfn $BASE/shared/.env $RELEASE_DIR/.env && \
  rm -rf $RELEASE_DIR/.wwebjs_auth && \
  ln -sfn $BASE/shared/.wwebjs_auth $RELEASE_DIR/.wwebjs_auth \
"

# 5) Cambiar symlink 'current' al release NUEVO (atómico)
ssh "$USER_HOST" "ln -sfn $RELEASE_DIR $BASE/current"

# 6) Reiniciar PM2 apuntando a 'current'
ssh "$USER_HOST" "\
  cd $BASE/current && \
  pm2 restart $PROC --update-env || pm2 start src/lia.js --name $PROC \
"

echo "✅ Listo. Current → $(ssh "$USER_HOST" 'readlink -f /opt/lia-pagare-v3/current')"
