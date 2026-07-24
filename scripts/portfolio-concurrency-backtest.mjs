/**
 * Shared-capital, concurrency-capped portfolio simulation over the proven
 * top-PF stock-options basket — answers "what's the real total P&L if I run
 * top-3 / top-5 / top-10 of these names off ONE account, with a hard cap on
 * how many can be open at once (start conservative at 3, scale to 10 as
 * capital allows)?" rather than summing independent per-symbol books.
 *
 * Every trade in this engine holds exactly 1 trading day (entry on bar[i]'s
 * signal, exit on bar[i+1] — the look-ahead-bias fix from the earlier pass),
 * so concurrency across symbols reduces to: how many symbols have a trade
 * whose [entryDate, exitDate] window overlaps a given day. Trade sizing
 * (~₹35k/trade, fixed) is taken as-is from each symbol's own real backtest
 * output — this does NOT re-simulate premiums, it replays REAL recorded
 * trade outcomes (entryDate/exitDate/pnl/totalValue) on a shared timeline.
 *
 * Usage: node scripts/portfolio-concurrency-backtest.mjs [baseUrl] [days]
 */
const BASE_URL = process.argv[2] || 'http://localhost:3000';
const DAYS = parseInt(process.argv[3] || '1825', 10);
const START_CAPITAL = 300000;

// Ranked strictly by profitFactor (desc) from the full 171-symbol run.
const TOP10_BY_PF = ['PIDILITIND', 'ITC', 'SOLARINDS', 'CROMPTON', 'BERGEPAINT', 'IRCTC', 'SUNPHARMA', 'VEDL', 'AXISBANK', 'UPL'];

async function fetchTrades(symbol) {
  const res = await fetch(`${BASE_URL}/api/backtest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, days: DAYS, engine: 'OPTIONS', config: { liveCapital: START_CAPITAL, engineMode: 'OPTIONS' } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'backtest failed');
  return (json.trades || []).map((t) => ({
    symbol,
    entryDate: t.entryDate,
    exitDate: t.exitDate,
    pnl: t.pnl,
    totalValue: t.totalValue,
  }));
}

function simulatePortfolio(trades, { maxConcurrent, startCapital, priorityOrder }) {
  const priorityRank = new Map(priorityOrder.map((s, i) => [s, i]));
  const byEntryDay = new Map();
  for (const t of trades) {
    const day = t.entryDate.slice(0, 10);
    if (!byEntryDay.has(day)) byEntryDay.set(day, []);
    byEntryDay.get(day).push(t);
  }
  for (const arr of byEntryDay.values()) {
    arr.sort((a, b) => (priorityRank.get(a.symbol) ?? 999) - (priorityRank.get(b.symbol) ?? 999));
  }

  const allDays = Array.from(new Set(trades.flatMap((t) => [t.entryDate.slice(0, 10), t.exitDate.slice(0, 10)]))).sort();

  let capital = startCapital;
  let peakCapital = startCapital;
  let maxDrawdown = 0;
  let peakConcurrent = 0;
  const open = [];
  const taken = [];
  let skipped = 0;
  const monthlyAgg = new Map();

  for (const day of allDays) {
    for (let i = open.length - 1; i >= 0; i--) {
      if (open[i].exitDay === day) {
        const t = open[i];
        capital += t.pnl;
        const month = day.slice(0, 7);
        const b = monthlyAgg.get(month) || { netPnl: 0, trades: 0, wins: 0 };
        b.netPnl += t.pnl; b.trades++; if (t.pnl > 0) b.wins++;
        monthlyAgg.set(month, b);
        open.splice(i, 1);
      }
    }
    peakCapital = Math.max(peakCapital, capital);
    maxDrawdown = Math.max(maxDrawdown, peakCapital > 0 ? ((peakCapital - capital) / peakCapital) * 100 : 0);

    const candidates = byEntryDay.get(day) || [];
    for (const t of candidates) {
      if (open.length >= maxConcurrent) { skipped++; continue; }
      if (t.totalValue > capital) { skipped++; continue; }
      open.push({ exitDay: t.exitDate.slice(0, 10), pnl: t.pnl });
      taken.push(t);
      peakConcurrent = Math.max(peakConcurrent, open.length);
    }
  }

  const wins = taken.filter((t) => t.pnl > 0).length;
  const grossWin = taken.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(taken.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));

  return {
    tradesTaken: taken.length,
    tradesSkippedByCap: skipped,
    peakConcurrent,
    winRate: taken.length ? Math.round((wins / taken.length) * 1000) / 10 : 0,
    profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : (grossWin > 0 ? null : 0),
    finalCapital: Math.round(capital),
    netProfit: Math.round(capital - startCapital),
    roiPct: Math.round(((capital - startCapital) / startCapital) * 1000) / 10,
    maxDrawdownPct: Math.round(maxDrawdown * 10) / 10,
    monthlyPnl: Array.from(monthlyAgg.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([m, b]) => ({
      month: m, trades: b.trades, winRate: b.trades ? Math.round((b.wins / b.trades) * 1000) / 10 : 0, netPnl: Math.round(b.netPnl),
    })),
  };
}

async function main() {
  console.log(`Fetching real trade-level backtests for ${TOP10_BY_PF.join(', ')} (${DAYS} days, OPTIONS mode)...\n`);
  const tradesBySymbol = {};
  for (const sym of TOP10_BY_PF) {
    tradesBySymbol[sym] = await fetchTrades(sym);
    console.log(`  ${sym}: ${tradesBySymbol[sym].length} real trades fetched`);
  }

  const scenarios = [
    { label: 'TOP-3, cap=3 (natural)', symbols: TOP10_BY_PF.slice(0, 3), cap: 3 },
    { label: 'TOP-5, cap=3 (conservative)', symbols: TOP10_BY_PF.slice(0, 5), cap: 3 },
    { label: 'TOP-5, cap=5 (natural)', symbols: TOP10_BY_PF.slice(0, 5), cap: 5 },
    { label: 'TOP-10, cap=3 (start conservative)', symbols: TOP10_BY_PF.slice(0, 10), cap: 3 },
    { label: 'TOP-10, cap=5 (scale up mid)', symbols: TOP10_BY_PF.slice(0, 10), cap: 5 },
    { label: 'TOP-10, cap=10 (fully scaled)', symbols: TOP10_BY_PF.slice(0, 10), cap: 10 },
  ];

  const allResults = {};
  console.log('\n================ PORTFOLIO SIMULATION RESULTS (shared ₹3L pool) ================');
  for (const sc of scenarios) {
    const trades = sc.symbols.flatMap((s) => tradesBySymbol[s]);
    const result = simulatePortfolio(trades, { maxConcurrent: sc.cap, startCapital: START_CAPITAL, priorityOrder: TOP10_BY_PF });
    allResults[sc.label] = result;
    console.log(`\n${sc.label} [${sc.symbols.join(',')}]`);
    console.log(`  trades taken=${result.tradesTaken}  skipped(cap)=${result.tradesSkippedByCap}  peakConcurrent=${result.peakConcurrent}`);
    console.log(`  winRate=${result.winRate}%  PF=${result.profitFactor}  maxDD=${result.maxDrawdownPct}%`);
    console.log(`  finalCapital=₹${result.finalCapital.toLocaleString('en-IN')}  netProfit=₹${result.netProfit.toLocaleString('en-IN')}  ROI=${result.roiPct}%`);
  }

  const fs = await import('fs');
  fs.writeFileSync(new URL('./portfolio-concurrency-backtest-results.json', import.meta.url), JSON.stringify({ scenarios: allResults, params: { days: DAYS, startCapital: START_CAPITAL, basket: TOP10_BY_PF } }, null, 2));
  console.log('\nFull results (incl. monthly P&L per scenario) written to scripts/portfolio-concurrency-backtest-results.json');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
