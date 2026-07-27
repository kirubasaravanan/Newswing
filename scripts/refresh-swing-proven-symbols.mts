/**
 * Automates what scripts/real-full-nse-swing-backtest.mjs's own docstring
 * called for but never had a mechanism to do: "re-run the backtest script
 * periodically (e.g. quarterly, or after any change to the swing entry
 * rules) and refresh this list by hand." This runs the same real
 * full-NSE-universe backtest, filters to the same proven criteria
 * (profitFactor > 1.4 AND totalTrades >= 15), cross-checks every
 * qualifying symbol against the live Dhan scrip master (same
 * symbol-series-check.ts used by the daily T2T re-check, task 25) so a
 * restricted-series symbol is excluded AT GENERATION TIME instead of being
 * discovered manually later, and overwrites swing-proven-symbols.ts
 * directly — review the git diff before committing, same as any other
 * code change; this doesn't bypass review, it just does the toil.
 *
 * Usage:
 *   1. Start the app: npm run dev
 *   2. npx tsx scripts/refresh-swing-proven-symbols.mts [baseUrl] [days]
 */
import fs from 'fs';
import path from 'path';
import { checkSymbolSeries } from '../src/lib/trading/symbol-series-check';

const BASE_URL = process.argv[2] || process.env.BACKTEST_BASE_URL || 'http://localhost:3000';
const DAYS = parseInt(process.argv[3] || '1825', 10);
const LIMIT = process.argv[4] ? parseInt(process.argv[4], 10) : null;
const START_CAPITAL = 300000;
const MIN_PROFIT_FACTOR = 1.4;
const MIN_TRADES = 15;
const OUTPUT_FILE = process.env.REFRESH_OUTPUT_FILE || path.join(process.cwd(), 'src/lib/trading/swing-proven-symbols.ts');

interface UniverseStock { symbol: string; sector?: string }
interface BacktestStats {
  profitFactor: number;
  totalTrades: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
}

async function getUniverse(): Promise<UniverseStock[]> {
  const res = await fetch(`${BASE_URL}/api/universe`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Universe fetch failed');
  return json.symbols;
}

async function runOne(symbol: string): Promise<BacktestStats> {
  const res = await fetch(`${BASE_URL}/api/backtest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, days: DAYS, engine: 'SWING', config: { liveCapital: START_CAPITAL, engineMode: 'SWING' } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'backtest failed');
  return json.stats;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  console.log(`Fetching real full NSE universe from ${BASE_URL} ...`);
  let universe = await getUniverse();
  if (LIMIT) universe = universe.slice(0, LIMIT);
  console.log(`Universe size: ${universe.length} stocks. Running ${DAYS}-day REAL SWING backtests...\n`);

  const results: Array<{ symbol: string; sector: string } & BacktestStats> = [];
  const failures: string[] = [];
  let done = 0;
  const startedAt = Date.now();

  for (const s of universe) {
    try {
      const stats = await runOne(s.symbol);
      results.push({ symbol: s.symbol, sector: s.sector || 'Unknown', ...stats });
    } catch (err) {
      failures.push(s.symbol);
    }
    done++;
    if (done % 25 === 0 || done === universe.length) {
      console.log(`  ...${done}/${universe.length} done (${Math.round((Date.now() - startedAt) / 1000)}s elapsed)`);
    }
  }

  const qualifying = results
    .filter((r) => r.profitFactor > MIN_PROFIT_FACTOR && r.totalTrades >= MIN_TRADES)
    .sort((a, b) => b.profitFactor - a.profitFactor);

  console.log(`\n${qualifying.length} of ${results.length} backtestable symbols qualified (PF>${MIN_PROFIT_FACTOR}, trades>=${MIN_TRADES}).`);
  console.log('Cross-checking against the live Dhan scrip master for restricted (T2T) series...');

  const seriesResults = checkSymbolSeries(qualifying.map((r) => r.symbol));
  const restrictedMap = new Map(seriesResults.filter((r) => r.restricted).map((r) => [r.symbol, r.series as string]));

  const included = qualifying.filter((r) => !restrictedMap.has(r.symbol));
  const excluded = qualifying.filter((r) => restrictedMap.has(r.symbol));

  if (excluded.length > 0) {
    console.log(`Excluding ${excluded.length} otherwise-qualifying symbol(s) for restricted trading series:`);
    for (const r of excluded) console.log(`  - ${r.symbol}: series ${restrictedMap.get(r.symbol)}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const symbolChunks = chunk(included.map((r) => `'${r.symbol}'`), 5);

  const lines: string[] = [
    '/**',
    ' * Real backtest-proven swing symbols — the intersection gate for the',
    ' * capacity-based pool in auto-trade/route.ts. Being highly RS-ranked',
    ' * (momentum/relative-strength) is a real but separate signal from "this',
    " * specific stock's price action actually suits the swing rule-set\" — the",
    ' * options backtest found exactly this split (high-beta PSU names ranked',
    ' * fine but lost badly), and the full-universe swing backtest below found',
    ' * the same split.',
    ' *',
    ` * Auto-regenerated by scripts/refresh-swing-proven-symbols.mts on ${today}`,
    ` * — real ${DAYS}-day, ${universe.length}-stock full-NSE-universe swing backtest,`,
    ` * filtered to profitFactor > ${MIN_PROFIT_FACTOR} AND totalTrades >= ${MIN_TRADES} (excludes both`,
    ' * weak performers and small-sample noise). Restricted-series (T2T)',
    ' * symbols are cross-checked and excluded automatically at generation',
    ' * time via symbol-series-check.ts (same live Dhan scrip master the daily',
    ' * re-check already uses) rather than requiring manual discovery later.',
    ` * ${included.length} of ${results.length} backtestable symbols qualified.`,
    ' *',
    ' * Still a static snapshot between runs, not a live recompute — re-run',
    ' * this script quarterly, or after any change to the swing entry rules',
    ' * in screening-engine.ts. Review the generated diff before committing,',
    ' * same as any other code change.',
    ' */',
    'export const SWING_PROVEN_SYMBOLS = new Set([',
    ...symbolChunks.map((c) => `  ${c.join(', ')},`),
    ']);',
    '',
    '/**',
    ' * Symbols that qualified on backtest performance but are currently',
    ' * excluded for trading-series restrictions (auto-detected at',
    ' * regeneration time, see symbol-series-check.ts).',
    ' */',
    'export const EXCLUDED_RESTRICTED_SYMBOLS: Record<string, string> = {',
    ...excluded.map((r) => `  ${r.symbol}: '${restrictedMap.get(r.symbol)} series as of ${today} — auto-excluded at regeneration',`),
    '};',
    '',
    '/**',
    ' * Per-symbol real backtest metrics for the names above — same source',
    ' * as SWING_PROVEN_SYMBOLS, just the actual numbers instead of a bare',
    ' * name list, so the dashboard can rank/display by real backtest',
    ' * quality instead of just listing symbols.',
    ' */',
    'export interface SwingProvenMetrics {',
    '  sector: string;',
    '  profitFactor: number;',
    '  totalTrades: number;',
    '  winRate: number;',
    '  sharpeRatio: number;',
    '  maxDrawdown: number;',
    '}',
    '',
    'export const SWING_PROVEN_METRICS: Record<string, SwingProvenMetrics> = {',
    ...included.map(
      (r) =>
        `  ${r.symbol}: { sector: '${r.sector}', profitFactor: ${r.profitFactor}, totalTrades: ${r.totalTrades}, winRate: ${r.winRate}, sharpeRatio: ${r.sharpeRatio}, maxDrawdown: ${r.maxDrawdown} },`
    ),
    '};',
    '',
  ];

  fs.writeFileSync(OUTPUT_FILE, lines.join('\n'));
  console.log(`\nRegenerated ${OUTPUT_FILE}`);
  console.log(`  Proven: ${included.length}  Excluded (restricted): ${excluded.length}  Failed: ${failures.length}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
