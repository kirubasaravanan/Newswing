#!/bin/bash
cd /home/z/my-project
while true; do
  npx next start -p 3000 2>/dev/null
  sleep 2
done
