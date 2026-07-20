#!/bin/bash
cd /home/z/my-project
PORT=3000 nohup node .next/standalone/server.js > /tmp/server.log 2>&1 &
disown
echo $! > server.pid
echo "Server started on PID $(cat server.pid), port 3000"
