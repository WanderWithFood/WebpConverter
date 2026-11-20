#!/usr/bin/env bash
# One-time setup of BINI Image Converter (WPC) on the TEST server.
# Run on the server as a sudo user:   bash setup-test-server.sh
# Safe to re-run. Does not touch other apps (own folder, own DB, own PM2 process, own port).
set -euo pipefail

APP_DIR=/opt/wpc
PORT=3100
DB_NAME=wpc_test
DB_USER=wpc
REPO=https://github.com/WanderWithFood/WebpConverter.git
PUBLIC_IP=$(curl -s https://api.ipify.org || hostname -I | awk '{print $1}')

echo "== 1. Packages"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
command -v psql >/dev/null || sudo apt-get install -y postgresql
command -v git  >/dev/null || sudo apt-get install -y git
command -v pm2  >/dev/null || sudo npm install -g pm2

echo "== 2. Database (separate from other apps)"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  DB_PASS=$(openssl rand -hex 24)
  sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
  echo "$DB_PASS" | sudo tee /root/.wpc_db_pass >/dev/null
fi
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  || sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
DB_PASS=$(sudo cat /root/.wpc_db_pass)

echo "== 3. Code"
sudo mkdir -p "$APP_DIR" && sudo chown "$USER" "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then git -C "$APP_DIR" pull --ff-only; else git clone "$REPO" "$APP_DIR"; fi
cd "$APP_DIR/backend"
npm ci --omit=dev

echo "== 4. Config (.env kept on re-run)"
if [ ! -f .env ]; then
  cat > .env <<EOF
NODE_ENV=development
APP_ENV=stage
PORT=$PORT
PUBLIC_URL=http://$PUBLIC_IP:$PORT
DATABASE_URL=postgres://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME
DATABASE_SSL=false
MASTER_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
DEV_LOGIN=false
TRUST_PROXY=0
SESSION_HOURS=8
API_RATE_PER_MIN=60
USER_RATE_PER_MIN=120
CONVERT_CONCURRENCY=2
CONVERT_TIMEOUT_SECONDS=30
MAX_PIXELS=100000000
STORAGE_DIR=./tmp-output
EOF
  chmod 600 .env
fi
npm run migrate

echo "== 5. Start"
if pm2 describe wpc-test >/dev/null 2>&1; then pm2 restart wpc-test --update-env; else pm2 start src/server.js --name wpc-test; fi
pm2 save
sudo command -v ufw >/dev/null && sudo ufw status | grep -q active && sudo ufw allow $PORT/tcp || true

sleep 2
curl -s "http://localhost:$PORT/healthz" && echo
echo
echo "Done. Open: http://$PUBLIC_IP:$PORT"
echo "Next (interactive, once):"
echo "  cd $APP_DIR/backend && npm run set-pin && npm run break-glass"
echo "  npm run add-user -- add you@bini.example \"Your Name\""
echo "Also open port $PORT in the DigitalOcean Cloud Firewall if one is attached."
