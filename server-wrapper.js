// Server wrapper with unhandled rejection protection
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
  // Don't crash
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Don't crash for known issues
  if (err.message?.includes('ECONNRESET') || err.message?.includes('ETIMEDOUT') || err.message?.includes('socket hang up')) {
    console.error('Network error - continuing...');
    return;
  }
});

require('./.next/standalone/server.js');