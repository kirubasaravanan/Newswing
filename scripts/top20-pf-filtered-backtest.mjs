/**
 * Focused 5-year OPTIONS backtest restricted to the stock-options universe's
 * top performers by profit factor — the "trade only what's proven, don't
 * trade the whole 189-stock universe" filter requested after reviewing the
 * fixed-sizing full-universe run. Selection rule: symbols with backtest
 * PF > 1.4, extended down to a round top-20 by PF (the two criteria disagree
 * by a few names right at the 1.4 boundary — HAVELLS/GODREJAGRO/BEML/TRENT
 * sit at PF 1.38-1.40 — so top-20-by-PF is used since it's the larger,
 * more inclusive set of the two, per instruction to use whichever gives more).
 *
 * Usage:
 *   node scripts/top20-pf-filtered-backtest.mjs [baseUrl] [days]
 */
const BASE_URL = process.argv[2] || 'http://localhost:3000';
const DAYS = parseInt(process.argv[3] || '1825', 10);
const START_CAPITAL = 300000;

// Ranked strictly by profitFactor (desc) from the full 171-symbol run
// (scripts/real-stock-options-backtest-results.json), top 20.
const TOP20_BY_PF = [
  'PIDILITIND', 'ITC', 'SOLARINDS', 'CROMPTON', 'BERGEPAINT', 'IRCTC',
  'SUNPHARMA', 'VEDL', 'AXISBANK', 'UPL', 'TATAMOTORS', 'ADANIPORTS',
  'CIPLA', 'ASIANPAINT', 'BATAINDIA', 'ICICIBANK', 'HAVELLS', 'GODREJAGRO',
  'BEML', 'TRENT',
];

async function runOne(symbol) {
  const res = await fetch(`${BASE_URL}/api/backtest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, days: DAYS, engine: 'OPTIONS', config: { liveCapital: START_CAPITAL, engineMode: 'OPTIONS' } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'backtest failed');
  return json;
}

async function main() {
  console.log(`Backtesting top-${TOP20_BY_PF.length} PF-filtered stocks over ${DAYS} days (OPTIONS mode)...\n`);
  const results = [];
  const monthlyAgg = new Map();

  for (const symbol of TOP20_BY_PF) {
    const r = await runOne(symbol);
    results.push({ symbol, ...r.stats });
    for (const m of r.monthlyPnl || []) {
      const bucket = monthlyAgg.get(m.month) || { netPnl: 0, trades: 0, wins: 0 };
      bucket.netPnl += m.netPnl;
      bucket.trades += m.trades;
      bucket.wins += Math.round((m.winRate / 100) * m.trades);
      monthlyAgg.set(m.month, bucket);
    }
    console.log(`${symbol.padEnd(14)} trades=${r.stats.totalTrades} winRate=${r.stats.winRate}% PF=${r.stats.profitFactor} maxDD=${r.stats.maxDrawdown}% final=₹${r.stats.finalCapital.toLocaleString('en-IN')}`);
  }

  const totalTrades = results.reduce((s, r) => s + r.totalTrades, 0);
  const totalWins = results.reduce((s, r) => s + r.winTrades, 0);
  const totalFinalCap = results.reduce((s, r) => s + r.finalCapital, 0);
  const totalStartCap = START_CAPITAL * results.length;
  const grossWins = results.reduce((s, r) => s + r.winTrades * r.avgWin, 0);
  const grossLosses = results.reduce((s, r) => s + r.lossTrades * r.avgLoss, 0);

  console.log('\n================ AGGREGATE: TOP-20 PF-FILTERED BASKET ================');
  console.log(JSON.stringify({
    symbols: results.length,
    totalTrades,
    blendedWinRate: Math.round((totalWins / totalTrades) * 1000) / 10,
    blendedProfitFactor: Math.round((grossWins / grossLosses) * 100) / 100,
    totalStartCapital: totalStartCap,
    totalFinalCapital: Math.round(totalFinalCap),
    netProfit: Math.round(totalFinalCap - totalStartCap),
    aggregateROIPct: Math.round(((totalFinalCap - totalStartCap) / totalStartCap) * 1000) / 10,
    avgSignalsPerTradingDayAcrossBasket: Math.round((totalTrades / (DAYS * 0.685)) * 100) / 100,
  }, null, 2));

  console.log('\n================ AGGREGATE MONTHLY P&L (TOP-20 BASKET) ================');
  const months = Array.from(monthlyAgg.keys()).sort();
  for (const m of months) {
    const b = monthlyAgg.get(m);
    const wr = b.trades > 0 ? Math.round((b.wins / b.trades) * 1000) / 10 : 0;
    console.log(`${m}  trades=${String(b.trades).padEnd(6)} winRate=${String(wr).padEnd(6)}%  netPnl=₹${Math.round(b.netPnl).toLocaleString('en-IN')}`);
  }

  const fs = await import('fs');
  const monthlyOut = months.map((m) => {
    const b = monthlyAgg.get(m);
    return { month: m, trades: b.trades, winRate: b.trades > 0 ? Math.round((b.wins / b.trades) * 1000) / 10 : 0, netPnl: Math.round(b.netPnl) };
  });
  fs.writeFileSync(new URL('./top20-pf-filtered-backtest-results.json', import.meta.url), JSON.stringify({ results, monthlyPnl: monthlyOut, params: { days: DAYS, startCapital: START_CAPITAL, symbols: TOP20_BY_PF } }, null, 2));
  console.log('\nFull results written to scripts/top20-pf-filtered-backtest-results.json');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
