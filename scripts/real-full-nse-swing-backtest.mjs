/**
 * REAL 5-Year Full-NSE-Universe SWING Backtest — every real stock in the
 * app's full NSE universe (Nifty50/100/F&O/mid/small-cap, ~600 deduped
 * symbols, the closest real data source to "NSE 500"), run through the
 * equity swing engine (EMA20/50 crossover + pullback + breakout, fixed
 * ₹75,000/stock allocation matching the live engine's real maxPerStock cap —
 * NOT a % of growing capital, same fix applied to the options engine
 * earlier this session).
 *
 * Usage:
 *   1. Start the app:  npm run dev
 *   2. node scripts/real-full-nse-swing-backtest.mjs [baseUrl] [days] [limit]
 */

const BASE_URL = process.argv[2] || process.env.BACKTEST_BASE_URL || 'http://localhost:3000';
const DAYS = parseInt(process.argv[3] || '1825', 10);
const LIMIT = process.argv[4] ? parseInt(process.argv[4], 10) : null;
const START_CAPITAL = 300000;

async function getUniverse() {
  const res = await fetch(`${BASE_URL}/api/universe`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Universe fetch failed');
  return json.symbols;
}

async function runOne(symbol) {
  const res = await fetch(`${BASE_URL}/api/backtest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, days: DAYS, engine: 'SWING', config: { liveCapital: START_CAPITAL, engineMode: 'SWING' } }),
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
  const header = ['Symbol', 'Sector', 'Trades', 'WinRate%', 'PF', 'MaxDD%', 'FinalCap', 'ROI%'];
  console.log(header.map((h, i) => h.padEnd(i === 0 ? 14 : i === 1 ? 16 : 10)).join(''));
  for (const r of rows) {
    const roi = Math.round(((r.finalCapital - START_CAPITAL) / START_CAPITAL) * 1000) / 10;
    const cells = [r.symbol, (r.sector || '-').slice(0, 15), r.totalTrades, r.winRate, r.profitFactor, r.maxDrawdown, r.finalCapital, roi];
    console.log(cells.map((c, i) => String(c).padEnd(i === 0 ? 14 : i === 1 ? 16 : 10)).join(''));
  }
}

async function main() {
  console.log(`Fetching real full NSE universe from ${BASE_URL} ...`);
  let universe = await getUniverse();
  if (LIMIT) universe = universe.slice(0, LIMIT);
  console.log(`Universe size: ${universe.length} stocks. Running ${DAYS}-day REAL SWING backtests (engine=SWING)...\n`);

  const results = [];
  const failures = [];
  let done = 0;
  const startedAt = Date.now();

  const monthlyAgg = new Map();
  const sectorAgg = new Map(); // sector -> { profitable, total, netPnl }

  for (const s of universe) {
    try {
      const r = await runOne(s.symbol);
      const row = { symbol: s.symbol, sector: s.sector, ...r.stats };
      results.push(row);
      for (const m of r.monthlyPnl || []) {
        const bucket = monthlyAgg.get(m.month) || { netPnl: 0, trades: 0, wins: 0 };
        bucket.netPnl += m.netPnl;
        bucket.trades += m.trades;
        bucket.wins += Math.round((m.winRate / 100) * m.trades);
        monthlyAgg.set(m.month, bucket);
      }
      const sBucket = sectorAgg.get(s.sector || 'Unknown') || { profitable: 0, total: 0, netPnl: 0 };
      sBucket.total++;
      if (row.finalCapital > START_CAPITAL) sBucket.profitable++;
      sBucket.netPnl += row.finalCapital - START_CAPITAL;
      sectorAgg.set(s.sector || 'Unknown', sBucket);
    } catch (err) {
      failures.push({ symbol: s.symbol, error: String(err?.message || err) });
    }
    done++;
    if (done % 25 === 0 || done === universe.length) {
      console.log(`  ...${done}/${universe.length} done (${Math.round((Date.now() - startedAt) / 1000)}s elapsed)`);
    }
  }

  results.sort((a, b) => b.finalCapital - a.finalCapital);

  console.log('\n================ BEST 25 SWING PERFORMERS ================');
  printTable(results.slice(0, 25));

  console.log('\n================ WORST 25 SWING PERFORMERS ================');
  printTable(results.slice(-25).reverse());

  const profitable = results.filter((r) => r.finalCapital > START_CAPITAL);
  const aggregate = {
    totalSymbols: results.length,
    profitableCount: profitable.length,
    unprofitableCount: results.length - profitable.length,
    avgWinRate: avg(results.map((r) => r.winRate)),
    avgProfitFactor: avg(results.map((r) => r.profitFactor)),
    avgMaxDrawdown: avg(results.map((r) => r.maxDrawdown)),
    avgFinalCapital: avg(results.map((r) => r.finalCapital)),
    avgSharpe: avg(results.map((r) => r.sharpeRatio)),
  };
  console.log('\n================ AGGREGATE SUMMARY (SWING, FULL NSE UNIVERSE) ================');
  console.log(JSON.stringify(aggregate, null, 2));

  console.log('\n================ SECTOR BREAKDOWN (sorted by avg net P&L/stock) ================');
  const sectorRows = Array.from(sectorAgg.entries())
    .map(([sector, b]) => ({ sector, total: b.total, profitablePct: Math.round((b.profitable / b.total) * 1000) / 10, avgNetPnl: Math.round(b.netPnl / b.total) }))
    .sort((a, b) => b.avgNetPnl - a.avgNetPnl);
  for (const r of sectorRows) {
    console.log(`${r.sector.padEnd(20)} n=${String(r.total).padEnd(5)} profitable=${String(r.profitablePct).padEnd(6)}%  avgNetPnl/stock=₹${r.avgNetPnl.toLocaleString('en-IN')}`);
  }

  console.log('\n================ AGGREGATE MONTHLY P&L (ACROSS ALL SYMBOLS) ================');
  const months = Array.from(monthlyAgg.keys()).sort();
  for (const m of months) {
    const b = monthlyAgg.get(m);
    const wr = b.trades > 0 ? Math.round((b.wins / b.trades) * 1000) / 10 : 0;
    console.log(`${m}  trades=${String(b.trades).padEnd(6)} winRate=${String(wr).padEnd(6)}%  netPnl=₹${Math.round(b.netPnl).toLocaleString('en-IN')}`);
  }

  if (failures.length) {
    console.log(`\n${failures.length} symbols failed:`);
    failures.slice(0, 30).forEach((f) => console.log(`  - ${f.symbol}: ${f.error}`));
  }

  const fs = await import('fs');
  const monthlyOut = months.map((m) => {
    const b = monthlyAgg.get(m);
    return { month: m, trades: b.trades, winRate: b.trades > 0 ? Math.round((b.wins / b.trades) * 1000) / 10 : 0, netPnl: Math.round(b.netPnl) };
  });
  fs.writeFileSync(
    new URL('./real-full-nse-swing-backtest-results.json', import.meta.url),
    JSON.stringify({ results, failures, aggregate, sectorRows, monthlyPnl: monthlyOut, params: { days: DAYS, startCapital: START_CAPITAL } }, null, 2)
  );
  console.log('\nFull results written to scripts/real-full-nse-swing-backtest-results.json');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
