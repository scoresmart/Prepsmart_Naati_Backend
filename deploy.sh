#!/bin/bash
set -e

echo "=== Prepsmart Backend Deployment ==="

# 1. Pull latest code
echo "[1/5] Pulling latest code..."
git pull origin main

# 2. Install dependencies
echo "[2/5] Installing dependencies..."
npm install --omit=dev

# 3. Create logs directory
echo "[3/5] Creating logs directory..."
mkdir -p logs

# 4. Reload or start with PM2
echo "[4/5] Starting/reloading PM2..."
if pm2 list | grep -q "prepsmart-backend"; then
  pm2 reload ecosystem.config.cjs --env production
else
  pm2 start ecosystem.config.cjs --env production
fi

# 5. Save PM2 process list (survives reboots)
echo "[5/5] Saving PM2 process list..."
pm2 save

echo ""
echo "=== Deployment complete ==="
pm2 status prepsmart-backend
