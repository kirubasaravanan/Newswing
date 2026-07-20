const { fork, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Robust self-daemonizing launcher with watchdog & crash recovery
// Usage: node daemon.js           → starts the server daemon
//        node daemon.js --stop    → kills the running daemon
//        node daemon.js --restart → stops then starts

const PID_FILE = path.join(__dirname, 'server.pid');
const LOG_FILE = '/tmp/server.log';
const PORT = 3000;

function stopDaemon() {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (pid) {
      try { process.kill(pid, 'SIGTERM'); } catch {}
      // Force kill after 3s
      setTimeout(() => {
        try { process.kill(pid, 'SIGKILL'); } catch {}
      }, 3000);
      console.log(`Stopping daemon PID ${pid}...`);
    }
  } catch {}
  try { fs.unlinkSync(PID_FILE); } catch {}
}

function healthCheck() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${PORT}/api/health`, { timeout: 5000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

if (process.argv.includes('--stop')) {
  stopDaemon();
  process.exit(0);
}

if (process.argv.includes('--restart')) {
  stopDaemon();
  // Wait for old process to die, then fall through
  setTimeout(() => { /* fall through handled below */ }, 3500);
}

// Daemonize: fork self with DAEMONIZED=1, then parent exits
if (process.env.DAEMONIZED !== '1') {
  const child = fork(__filename, process.argv.slice(2), {
    detached: true,
    stdio: ['ignore', fs.openSync(LOG_FILE, 'w'), fs.openSync(LOG_FILE, 'w')],
    env: { ...process.env, DAEMONIZED: '1', PORT: String(PORT), NODE_ENV: 'production' }
  });
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));
  console.log(`Daemon started as PID ${child.pid}`);
  process.exit(0);
}

// ── This IS the daemon process ──
// Log to file for debugging
const logStream = fs.openSync(LOG_FILE, 'w');
const log = (msg) => {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  fs.writeSync(logStream, line);
};

// Handle unhandled errors to prevent silent crashes
process.on('uncaughtException', (err) => {
  log(`UNCAUGHT EXCEPTION: ${err.message}\n${err.stack}`);
});

process.on('unhandledRejection', (reason) => {
  log(`UNHANDLED REJECTION: ${reason}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log('Received SIGTERM, shutting down...');
  try { fs.unlinkSync(PID_FILE); } catch {}
  process.exit(0);
});

process.on('SIGINT', () => {
  log('Received SIGINT, shutting down...');
  try { fs.unlinkSync(PID_FILE); } catch {}
  process.exit(0);
});

// Start server with crash recovery
function startServer() {
  log('Starting Next.js server...');

  const serverPath = path.join(__dirname, '.next/standalone/server.js');

  // Use spawn instead of require() so we can catch crashes and restart
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
    stdio: ['ignore', logStream, logStream],
    detached: false
  });

  child.on('error', (err) => {
    log(`Spawn error: ${err.message}`);
    setTimeout(startServer, 5000); // Restart after 5s
  });

  child.on('exit', (code, signal) => {
    log(`Server exited with code=${code} signal=${signal}`);
    if (code !== 0 && code !== null) {
      log('Crash detected, restarting in 5s...');
      setTimeout(startServer, 5000);
    }
  });

  // Update PID file to child process
  fs.writeFileSync(PID_FILE, String(child.pid));
  log(`Server child PID: ${child.pid}`);
}

log('=== Daemon process started ===');
startServer();

// Health check watchdog — verify server is actually responding
let watchdogInterval;
async function watchdog() {
  const healthy = await healthCheck();
  if (!healthy) {
    log('Health check FAILED — server may be unresponsive');
  }
}
// Start checking after 10s, then every 60s
setTimeout(() => {
  watchdog();
  watchdogInterval = setInterval(watchdog, 60000);
}, 10000);