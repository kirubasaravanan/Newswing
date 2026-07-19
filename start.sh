#!/bin/bash
# PMS Server - start and keep alive
cd /home/z/my-project

# Kill any existing
pkill -f "server.js" 2>/dev/null
pkill -f "next" 2>/dev/null
sleep 1

echo "Starting PMS server..."
NODE_ENV=production node /home/z/my-project/.next/standalone/server.js &
echo $! > /home/z/my-project/server.pid
echo "PID: $(cat /home/z/my-project/server.pid)"

# Wait for ready
for i in $(seq 1 15); do
  sleep 1
  if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ 2>/dev/null | grep -q "200"; then
    echo "PMS Ready - http://localhost:3000"
    exit 0
  fi
done
echo "ERROR: Server failed to start"
exit 1