#!/bin/bash
# Watchdog: keeps Next.js dev server alive and pre-warms it
cd /home/z/my-project

while true; do
  if ! lsof -i :3000 >/dev/null 2>&1; then
    echo "[$(date)] Server not running, starting..."
    rm -f dev.log
    nohup npx next dev -p 3000 -H 0.0.0.0 > dev.log 2>&1 &
    SRV_PID=$!
    echo "[$(date)] Started PID $SRV_PID, waiting for ready..."
    
    # Wait up to 30s for server to be ready
    for i in $(seq 1 30); do
      sleep 1
      if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null | grep -q "200"; then
        echo "[$(date)] Server ready, pre-warming compilation..."
        # Pre-warm: hit the page so Next.js compiles it
        curl -s -o /dev/null http://localhost:3000/ 2>/dev/null
        echo "[$(date)] Pre-warm done"
        break
      fi
    done
  fi
  sleep 5
done