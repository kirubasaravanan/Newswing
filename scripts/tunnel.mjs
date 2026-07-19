import { createServer } from 'http';
import { spawn } from 'child_process';

// Start Next.js server
const next = spawn('npx', ['next', 'start', '-p', '3000'], {
  cwd: '/home/z/my-project',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: '3000' }
});

let nextOutput = '';
next.stdout.on('data', d => { nextOutput += d.toString(); });
next.stderr.on('data', d => { nextOutput += d.toString(); });

// Wait for Next.js to be ready
await new Promise(r => setTimeout(r, 6000));
console.log('Next.js output:', nextOutput.slice(-200));

// Import and start localtunnel
const lt = await import('localtunnel');
const tunnel = await lt.default(3000);
console.log('TUNNEL_URL:' + tunnel.url);

// Write URL to file for easy reading
const fs = await import('fs');
fs.writeFileSync('/tmp/tunnel-url-final.txt', tunnel.url);

// Keep alive
tunnel.on('close', () => { console.log('Tunnel closed'); process.exit(1); });
setInterval(() => {}, 10000);