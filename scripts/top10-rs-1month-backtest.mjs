/**
 * Real 1-month OPTIONS backtest of TODAY's actual Top-10 RS-ranked symbols
 * (from the live WeeklyRanking table computed by rs-ranking.ts) — checks
 * whether stocks the equity RS engine currently ranks as the strongest
 * relative-strength names ALSO perform well when traded via the OPTIONS
 * engine (Black-Scholes + confluence signal), not just as equity swing.
 */
const BASE_URL = process.argv[2] || 'http://localhost:3000';
const DAYS = parseInt(process.argv[3] || '30', 10);
const START_CAPITAL = 300000;

// Today's real Top-10 RS ranking, pulled live from the WeeklyRanking table.
// Only 3 of these 10 actually have real listed F&O options (checked against
// /api/options/universe) — the equity RS engine scans the full NSE universe
// without regard to F&O eligibility, so it can surface strong momentum names
// that simply have no options market. Backtesting "options" on the other 7
// would be a purely theoretical exercise with zero real tradeability, so
// they're excluded rather than presented as an actionable result.
const TOP10 = ['KALYANKJIL', 'LAURUSLABS', 'THYROCARE', 'LODHA', 'GABRIEL', 'WELCORP', 'EXIDEIND', 'SONACOMS', 'IIFL', 'MANAPPURAM'];
const HAS_REAL_OPTIONS = new Set(['LAURUSLABS', 'EXIDEIND', 'MANAPPURAM']);

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
  console.log(`Today's real Top-10 RS ranking: ${TOP10.join(', ')}`);
  const noOptions = TOP10.filter((s) => !HAS_REAL_OPTIONS.has(s));
  console.log(`No real listed F&O options exist for: ${noOptions.join(', ')} — excluded from this options backtest (not a real tradeable question for them).\n`);

  console.log(`Backtesting the ${HAS_REAL_OPTIONS.size} symbols that DO have real options, over the last ${DAYS} days (OPTIONS mode)...\n`);
  const results = [];
  for (const symbol of TOP10.filter((s) => HAS_REAL_OPTIONS.has(s))) {
    try {
      const r = await runOne(symbol);
      results.push({ symbol, ...r.stats });
      console.log(`${symbol.padEnd(14)} trades=${r.stats.totalTrades} winRate=${r.stats.winRate}% PF=${r.stats.profitFactor} maxDD=${r.stats.maxDrawdown}% final=₹${r.stats.finalCapital}`);
    } catch (err) {
      console.log(`${symbol.padEnd(14)} ERROR: ${err.message}`);
      results.push({ symbol, error: String(err.message) });
    }
  }

  const fs = await import('fs');
  fs.writeFileSync(new URL('./top10-rs-1month-results.json', import.meta.url), JSON.stringify(results, null, 2));
  console.log('\nFull results written to scripts/top10-rs-1month-results.json');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
