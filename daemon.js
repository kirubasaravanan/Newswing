const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');

// Self-daemonizing launcher: double-fork to fully detach from parent shell.
// Usage: node daemon.js           → starts the server daemon
//        node daemon.js --stop    → kills the running daemon

const PID_FILE = path.join(__dirname, 'server.pid');

function stopDaemon() {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (pid && kill(pid, 0)) {
      process.kill(pid, 'SIGTERM');
      console.log(`Stopped daemon PID ${pid}`);
    }
  } catch {}
}

if (process.argv.includes('--stop')) {
  stopDaemon();
  process.exit(0);
}

if (process.argv.includes('--restart')) {
  stopDaemon();
  // fall through to start
}

// Daemonize: fork self with DAEMONIZED=1, then parent exits
if (process.env.DAEMONIZED !== '1') {
  const child = fork(__filename, process.argv.slice(2), {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, DAEMONIZED: '1', PORT: '3000', NODE_ENV: 'production' }
  });
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));
  console.log(`Daemon started as PID ${child.pid}`);
  process.exit(0);
}

// This IS the daemon process — it survives because it's detached
const serverPath = path.join(__dirname, '.next/standalone/server.js');
require(serverPath);