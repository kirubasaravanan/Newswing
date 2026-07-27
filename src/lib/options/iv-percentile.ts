/**
 * IV Percentile — how expensive is this option, for THIS symbol, right now?
 *
 * Ported from ODSS-ENGINE's iv-percentile.ts. ODSS's own comment cites a
 * 74,515 direction-neutral straddle observation study: holding optionality
 * when IV sits in the top 20% of a symbol's own recent range is consistently
 * the worst-performing bucket (avg -2.24%/-0.54% over 30min, vs +0.69%/-0.22%
 * in the bottom 20%). Buying when vol is rich for that name is one of the
 * most avoidable mistakes available to an option buyer — the confluence
 * scanner had no notion of this at all before this pass.
 *
 * An absolute IV number is meaningless across symbols (18% is rich for one
 * name, cheap for another), so this tracks each symbol's IV against its OWN
 * observed history, persisted via AppSettings (this codebase's existing
 * generic KV store — see auto-trade/route.ts's scheduler state for the same
 * pattern) rather than ODSS's flat-file JSON store, to stay consistent with
 * how this codebase already persists everything else.
 *
 * Depends on real per-strike IV actually being computed (dhan-option-
 * provider.ts's impliedVolatility() wiring, fixed this same session) — this
 * module would be meaningless built on the previous hardcoded flat 20% IV.
 */
import { db } from '@/lib/db';

interface IVSample { v: number; t: number } // value, timestamp
interface SymbolIVHistory { samples: IVSample[] }

const MAX_SAMPLES = 600;          // ~a month of session samples per symbol
const MIN_FOR_READ = 40;          // below this a percentile is meaningless
const MIN_RECORD_GAP_MS = 5 * 60_000; // one sample per ~5 min per symbol, matches ODSS
const SPIKE_LOOKBACK_MS = 60 * 60_000; // 1h

function keyFor(symbol: string): string {
  return `iv_hist_${symbol.toUpperCase()}`;
}

async function loadHistory(symbol: string): Promise<SymbolIVHistory> {
  const row = await db.appSettings.findUnique({ where: { key: keyFor(symbol) } });
  if (!row) return { samples: [] };
  try {
    const parsed = JSON.parse(row.value);
    if (parsed && Array.isArray(parsed.samples)) return parsed;
  } catch { /* corrupt/legacy value — treat as fresh */ }
  return { samples: [] };
}

async function saveHistory(symbol: string, hist: SymbolIVHistory): Promise<void> {
  const value = JSON.stringify(hist);
  await db.appSettings.upsert({
    where: { key: keyFor(symbol) },
    create: { key: keyFor(symbol), value },
    update: { value },
  });
}

/** Record the current ATM IV for a symbol (call once per chain fetch during a scan). */
export async function recordIV(symbol: string, atmIV: number): Promise<void> {
  if (!(atmIV > 1) || atmIV > 200) return; // ignore degenerate values (matches ODSS's guard)
  const hist = await loadHistory(symbol);
  const now = Date.now();
  const last = hist.samples[hist.samples.length - 1];
  if (last && now - last.t < MIN_RECORD_GAP_MS) return; // throttle, avoids one busy symbol flooding its own distribution
  hist.samples.push({ v: +atmIV.toFixed(2), t: now });
  if (hist.samples.length > MAX_SAMPLES) hist.samples = hist.samples.slice(-MAX_SAMPLES);
  await saveHistory(symbol, hist);
}

/**
 * Where does `atmIV` sit in this symbol's own history? 0 = cheapest ever
 * seen, 1 = richest. null when there isn't enough history to judge yet —
 * callers MUST treat that as "no opinion", never as "cheap".
 */
export async function getIVPercentile(symbol: string, atmIV: number): Promise<number | null> {
  if (!(atmIV > 0)) return null;
  const hist = await loadHistory(symbol);
  if (hist.samples.length < MIN_FOR_READ) return null;
  const sorted = hist.samples.map((s) => s.v).sort((a, b) => a - b);
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < atmIV) lo = m + 1; else hi = m; }
  return +(lo / sorted.length).toFixed(2);
}

/**
 * ATM-IV spike over the last hour (%). A jump means option premiums have
 * repriced UP — a buyer entering now pays for volatility that can mean-
 * revert against them even when direction is right. null until there's
 * enough history to compare against.
 */
export async function getIVSpikePct(symbol: string): Promise<number | null> {
  const hist = await loadHistory(symbol);
  if (hist.samples.length < 2) return null;
  const cur = hist.samples[hist.samples.length - 1];
  const target = cur.t - SPIKE_LOOKBACK_MS;
  let prev: IVSample | null = null;
  for (const s of hist.samples) { if (s.t <= target) prev = s; else break; }
  if (!prev) prev = hist.samples[0]; // partial history — use oldest available
  if (!prev || prev.v <= 4 || cur.v <= 0) return null; // degenerate IVs = no read
  return Math.round(((cur.v - prev.v) / prev.v) * 100);
}
