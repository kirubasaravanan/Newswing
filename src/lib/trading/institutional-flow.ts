/**
 * Real FII/DII institutional flow bias — the "smart money" signal Forex
 * already has via real CFTC COT positioning (cot_positioning.py);
 * equity/options had no analogous signal at all.
 *
 * Cached with a DAILY TTL, not re-fetched per scan cycle — FII/DII cash-
 * market data only updates once per trading day (published after the
 * session closes, "provisional" during the day), so re-fetching it every
 * scan would waste real NSE API calls on data that hasn't changed. Same
 * low-frequency-refresh principle as Forex's central_banks.py rate table.
 */
import { fetchFiiDiiFlow } from '../nse-data';

export interface InstitutionalFlowBias {
  date: string;
  fiiNetCr: number;
  diiNetCr: number;
  combinedNetCr: number;
  bias: 'bullish' | 'bearish' | 'neutral';
  adjustment: number; // confidence points (0-100 scale), modest, additive
  reason: string;
}

// Deliberately modest — a real but brand-new, unvalidated factor. Smaller
// than symbol-reputation's +-15 (that's backed by this exact rule-set's own
// track record; this is a market-wide macro signal with no forward-tested
// history yet against this strategy).
const MAX_ADJUSTMENT = 8;
// Combined net flow within +-1000cr = no strong signal either way — FII/DII
// flows are noisy day to day; only a meaningfully large combined move
// counts as a real signal.
const NEUTRAL_THRESHOLD_CR = 1000;
// Combined flow magnitude that saturates the adjustment at MAX_ADJUSTMENT.
const SATURATION_CR = 5000;

let cached: InstitutionalFlowBias | null = null;
let cachedDate = '';

function todayIST(): string {
  // NSE reports in IST; a simple date-only cache key is enough since this
  // only refreshes once per real trading day regardless of exact time zone
  // edge cases at midnight.
  return new Date().toISOString().slice(0, 10);
}

/** Real FII/DII bias for today, cached for the rest of the day. Returns
 * null if NSE fails or hasn't published today's numbers yet — never
 * fabricates a neutral 0, same "no opinion on missing data" convention
 * used everywhere else this session. */
export async function getInstitutionalFlowBias(): Promise<InstitutionalFlowBias | null> {
  const today = todayIST();
  if (cached && cachedDate === today) return cached;

  const data = await fetchFiiDiiFlow();
  if (!data) return null;

  const fii = data.find((d) => d.category === 'FII/FPI');
  const dii = data.find((d) => d.category === 'DII');
  if (!fii || !dii) return null;

  const combined = Math.round((fii.netValueCr + dii.netValueCr) * 100) / 100;
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let adjustment = 0;
  if (Math.abs(combined) > NEUTRAL_THRESHOLD_CR) {
    bias = combined > 0 ? 'bullish' : 'bearish';
    const magnitude = Math.min(1, Math.abs(combined) / SATURATION_CR);
    adjustment = Math.round((combined > 0 ? 1 : -1) * magnitude * MAX_ADJUSTMENT * 10) / 10;
  }

  const result: InstitutionalFlowBias = {
    date: fii.date,
    fiiNetCr: fii.netValueCr,
    diiNetCr: dii.netValueCr,
    combinedNetCr: combined,
    bias,
    adjustment,
    reason: `FII ${fii.netValueCr >= 0 ? '+' : ''}₹${fii.netValueCr}cr, DII ${dii.netValueCr >= 0 ? '+' : ''}₹${dii.netValueCr}cr (combined ${combined >= 0 ? '+' : ''}₹${Math.round(combined)}cr) — ${bias}`,
  };
  cached = result;
  cachedDate = today;
  return result;
}
