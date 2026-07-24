/**
 * REAL 5-Year Backtest — Full F&O Universe (Indices + Stock Options)
 *
 * Unlike scripts/test-full-200-fno-universe.mjs (which is a hardcoded table
 * of invented win rates/gains — NOT real data), this script calls the app's
 * own /api/backtest endpoint for every real F&O-eligible symbol. That means
 * it runs the EXACT SAME runBacktest() engine the live UI uses — the one
 * fixed for look-ahead bias (entry decisions no longer see their own
 * outcome) and capital-exhaustion accounting (an account can't go negative).
 * There is no duplicated backtest logic in this file — only orchestration,
 * ranking, and reporting.
 *
 * Usage:
 *   1. Start the app:  npm run dev   (or npm start for a production build)
 *   2. In another terminal:
 *        node scripts/real-full-universe-backtest.mjs [baseUrl] [days]
 *      Defaults: baseUrl=http://localhost:3000, days=1825 (5 years)
 *
 *   Quick subset test (first 10 symbols only), useful before a full run:
 *        node scripts/real-full-universe-backtest.mjs http://localhost:3000 1825 10
 */

const BASE_URL = process.argv[2] || process.env.BACKTEST_BASE_URL || 'http://localhost:3000';
const DAYS = parseInt(process.argv[3] || '1825', 10);
const LIMIT = process.argv[4] ? parseInt(process.argv[4], 10) : null;
const START_CAPITAL = 300000;

async function getUniverse() {
  const res = await fetch(`${BASE_URL}/api/options/universe`);
  if (!res.ok) throw new Error(`Failed to fetch universe list: HTTP ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Universe fetch failed');
  return json.symbols;
}

async function runOne(symbol) {
  const res = await fetch(`${BASE_URL}/api/backtest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, days: DAYS, config: { liveCapital: START_CAPITAL } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'backtest failed');
  return json;
}

function avg(arr) {
  const nums = arr.filter((n) => typeof n === 'number' && isFinite(n));
  return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : 0;
}

function printTable(rows) {
  const header = ['Symbol', 'Engine', 'Trades', 'WinRate%', 'PF', 'MaxDD%', 'FinalCap', 'ROI%'];
  console.log(header.map((h, i) => h.padEnd(i === 0 ? 14 : 9)).join(''));
  for (const r of rows) {
    const roi = Math.round(((r.finalCapital - START_CAPITAL) / START_CAPITAL) * 1000) / 10;
    const cells = [r.symbol, r.engine, r.totalTrades, r.winRate, r.profitFactor, r.maxDrawdown, r.finalCapital, roi];
    console.log(cells.map((c, i) => String(c).padEnd(i === 0 ? 14 : 9)).join(''));
  }
}

async function main() {
  console.log(`Fetching real F&O universe from ${BASE_URL} ...`);
  let universe = await getUniverse();
  if (LIMIT) universe = universe.slice(0, LIMIT);
  console.log(`Universe size: ${universe.length} symbols. Running ${DAYS}-day real backtests`);
  console.log('(real historical data + real Black-Scholes pricing for options — this can take several minutes)...\n');

  const results = [];
  const failures = [];
  let done = 0;
  const startedAt = Date.now();

  for (const symbol of universe) {
    try {
      const r = await runOne(symbol);
      results.push({ symbol, engine: r.engine, ...r.stats });
    } catch (err) {
      failures.push({ symbol, error: String(err?.message || err) });
    }
    done++;
    if (done % 10 === 0 || done === universe.length) {
      const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
      console.log(`  ...${done}/${universe.length} done (${elapsedSec}s elapsed)`);
    }
  }

  results.sort((a, b) => b.finalCapital - a.finalCapital);

  console.log('\n================ BEST 15 PERFORMERS ================');
  printTable(results.slice(0, 15));

  console.log('\n================ WORST 15 PERFORMERS ================');
  printTable(results.slice(-15).reverse());

  const profitable = results.filter((r) => r.finalCapital > START_CAPITAL);
  const unprofitable = results.filter((r) => r.finalCapital <= START_CAPITAL);

  const aggregate = {
    totalSymbols: results.length,
    profitableCount: profitable.length,
    unprofitableCount: unprofitable.length,
    avgWinRate: avg(results.map((r) => r.winRate)),
    avgProfitFactor: avg(results.map((r) => r.profitFactor)),
    avgMaxDrawdown: avg(results.map((r) => r.maxDrawdown)),
    avgFinalCapital: avg(results.map((r) => r.finalCapital)),
    avgSharpe: avg(results.map((r) => r.sharpeRatio)),
  };

  console.log('\n================ AGGREGATE SUMMARY (ACROSS ALL REAL RESULTS) ================');
  console.log(JSON.stringify(aggregate, null, 2));

  if (failures.length) {
    console.log(`\n${failures.length} symbols failed to backtest (insufficient data, fetch errors, etc.):`);
    failures.slice(0, 30).forEach((f) => console.log(`  - ${f.symbol}: ${f.error}`));
    if (failures.length > 30) console.log(`  ...and ${failures.length - 30} more (see full JSON output)`);
  }

  const fs = await import('fs');
  const outPath = new URL('./real-full-universe-backtest-results.json', import.meta.url);
  fs.writeFileSync(outPath, JSON.stringify({ results, failures, aggregate, params: { days: DAYS, startCapital: START_CAPITAL } }, null, 2));
  console.log(`\nFull results (all ${results.length} symbols) written to scripts/real-full-universe-backtest-results.json`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
