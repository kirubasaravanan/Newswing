/**
 * Option-Chain + Delta Confluence Engine (multi-timeframe)
 * =========================================================
 * Ported from ODSS-ENGINE's oc-confluence.ts. Consumes REAL option chains
 * (already fetched via dhan-option-provider.ts) and tracks how OI, PCR, IV
 * and ATM greeks (delta) evolve over three horizons — 5m (timing), 15m
 * (confirmation) and 1h (intraday regime). Turns that into:
 *
 *   - an OI-action classification (long buildup / short covering / short
 *     buildup / long unwinding) — the classic price x OI quadrants applied
 *     to calls and puts,
 *   - a direction-aligned confluence score (0-100),
 *   - an ENTRY-timing signal so a pick is entered when the chain confirms
 *     the technical setup (not too early, not too late).
 *
 * This is real order-flow signal the options engine had NO equivalent of
 * before this port — options-scanner.ts's confluence score is built purely
 * from price/structure technicals; nothing in it read real OI/PCR/delta
 * *change over time* to judge whether the chain itself agrees with the
 * technical setup.
 *
 * State (per-symbol minute-resolution history) is persisted via this
 * codebase's existing AppSettings KV store (same pattern as iv-percentile.ts)
 * rather than ODSS's flat-file JSON store, to match how everything else in
 * this codebase persists state.
 */
import { db } from '@/lib/db';
import type { OptionChainResult } from './option-chain';

export type Direction = 'CE' | 'PE';
export type OIAction = 'LONG_BUILDUP' | 'SHORT_COVERING' | 'SHORT_BUILDUP' | 'LONG_UNWINDING' | 'NEUTRAL';
export type OCEntrySignal = 'ENTER' | 'WAIT' | 'AVOID';

export interface Snapshot {
  ts: number; spot: number;
  atmCallDelta: number; atmPutDelta: number; atmIV: number;
  pcr: number; callOI: number; putOI: number; maxPain: number;
}

export interface TFResult {
  tf: '5m' | '15m' | '1h';
  priceChangePct: number;
  callOIChangePct: number;
  putOIChangePct: number;
  pcrChange: number;
  score: number; // 0-100, direction-aligned
  verdict: string;
}

export interface OCConfluence {
  symbol: string; direction: Direction;
  ocScore: number;
  oiAction: OIAction;
  pcr: number; pcrTrend: 'RISING' | 'FALLING' | 'FLAT';
  ivTrend: 'RISING' | 'FALLING' | 'FLAT';
  atmDelta: number;
  tf: Record<'5m' | '15m' | '1h', TFResult>;
  entrySignal: OCEntrySignal;
  headline: string;
  notes: string[];
  updatedAt: number;
}

const HISTORY_CAP = 140;         // >1h at 1-min resolution (with buffer)
const MIN_RESOLUTION_MS = 60_000;
const TF_MS = { '5m': 5 * 60_000, '15m': 15 * 60_000, '1h': 60 * 60_000 } as const;

function keyFor(symbol: string): string {
  return `oc_hist_${symbol.toUpperCase()}`;
}

async function loadSnaps(symbol: string): Promise<Snapshot[]> {
  const row = await db.appSettings.findUnique({ where: { key: keyFor(symbol) } });
  if (!row) return [];
  try { const parsed = JSON.parse(row.value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

async function saveSnaps(symbol: string, snaps: Snapshot[]): Promise<void> {
  const value = JSON.stringify(snaps);
  await db.appSettings.upsert({ where: { key: keyFor(symbol) }, create: { key: keyFor(symbol), value }, update: { value } });
}

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));

function snapshotFromChain(chainResult: OptionChainResult): Snapshot | null {
  const atmRow = chainResult.chain.find((r) => r.moneyness === 'ATM');
  if (!atmRow) return null;
  return {
    ts: Date.now(),
    spot: chainResult.underlyingPrice,
    atmCallDelta: atmRow.ce?.delta ?? 0,
    atmPutDelta: atmRow.pe?.delta ?? 0,
    atmIV: ((atmRow.ce?.iv ?? 0) + (atmRow.pe?.iv ?? 0)) / 2 || (atmRow.ce?.iv ?? atmRow.pe?.iv ?? 0),
    pcr: chainResult.pcr?.pcr ?? 0,
    callOI: chainResult.pcr?.totalCEOI ?? 0,
    putOI: chainResult.pcr?.totalPEOI ?? 0,
    maxPain: chainResult.maxPain?.maxPainStrike ?? chainResult.underlyingPrice,
  };
}

/** Find the snapshot closest to (now - tfMs); falls back to the oldest we have. */
function lookback(snaps: Snapshot[], tfMs: number): Snapshot | null {
  if (snaps.length < 2) return null;
  const now = snaps[snaps.length - 1].ts;
  const target = now - tfMs;
  let best: Snapshot | null = null;
  for (const s of snaps) { if (s.ts <= target) best = s; else break; }
  return best ?? snaps[0]; // partial history -> use oldest
}

const pctChange = (cur: number, prev: number) => (prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : 0);

/**
 * Direction-aligned score for one timeframe from price x OI x PCR behaviour.
 * Bullish (CE) rewards: price up, put OI up (put writing / support), call OI
 * down on up-move (short covering), rising PCR. Mirror for PE.
 */
export function scoreTF(dir: Direction, cur: Snapshot, prev: Snapshot, tf: TFResult['tf']): TFResult {
  const bull = dir === 'CE';
  const priceChangePct = pctChange(cur.spot, prev.spot);
  const callOIChangePct = pctChange(cur.callOI, prev.callOI);
  const putOIChangePct = pctChange(cur.putOI, prev.putOI);
  const pcrChange = cur.pcr - prev.pcr;

  let s = 50;
  const up = priceChangePct > 0.05, down = priceChangePct < -0.05;
  if (bull) {
    if (up && putOIChangePct > 2) s += 18;
    if (up && callOIChangePct < -2) s += 14;
    if (up && callOIChangePct > 5) s -= 14;
    if (down && callOIChangePct > 2) s -= 12;
    if (down && putOIChangePct < -2) s -= 8;
    s += clamp(pcrChange * 30, -12, 12);
    s += clamp(priceChangePct * 6, -12, 14);
  } else {
    if (down && callOIChangePct > 2) s += 18;
    if (down && putOIChangePct < -2) s += 14;
    if (down && putOIChangePct > 5) s -= 14;
    if (up && putOIChangePct > 2) s -= 12;
    if (up && callOIChangePct < -2) s -= 8;
    s -= clamp(pcrChange * 30, -12, 12);
    s += clamp(-priceChangePct * 6, -12, 14);
  }
  const dCur = bull ? cur.atmCallDelta : -cur.atmPutDelta;
  const dPrev = bull ? prev.atmCallDelta : -prev.atmPutDelta;
  s += clamp((dCur - dPrev) * 120, -10, 12);
  const score = Math.round(clamp(s));
  const verdict = score >= 62 ? `${tf} confirms ${bull ? 'bullish' : 'bearish'}` : score <= 38 ? `${tf} contradicts` : `${tf} mixed`;
  return { tf, priceChangePct, callOIChangePct, putOIChangePct, pcrChange, score, verdict };
}

export function classifyOI(dir: Direction, cur: Snapshot, prev: Snapshot): OIAction {
  const priceUp = cur.spot > prev.spot;
  const oiCur = dir === 'CE' ? cur.callOI : cur.putOI;
  const oiPrev = dir === 'CE' ? prev.callOI : prev.putOI;
  const oiUp = oiCur > oiPrev * 1.005;
  const oiDown = oiCur < oiPrev * 0.995;
  if (dir === 'CE') {
    if (priceUp && oiUp) return 'SHORT_BUILDUP';
    if (priceUp && oiDown) return 'SHORT_COVERING';
    if (!priceUp && oiUp) return 'SHORT_BUILDUP';
    if (!priceUp && oiDown) return 'LONG_UNWINDING';
  } else {
    if (!priceUp && oiUp) return 'SHORT_BUILDUP';
    if (!priceUp && oiDown) return 'SHORT_COVERING';
    if (priceUp && oiUp) return 'LONG_BUILDUP';
    if (priceUp && oiDown) return 'LONG_UNWINDING';
  }
  return 'NEUTRAL';
}

/**
 * Update confluence for a symbol with a fresh chain. `direction` is the side
 * we're evaluating an entry for. Returns null if the chain has no ATM row
 * (never fabricates a snapshot).
 */
export async function updateOCConfluence(symbol: string, chainResult: OptionChainResult, direction: Direction): Promise<OCConfluence | null> {
  const snap = snapshotFromChain(chainResult);
  if (!snap) return null;

  let snaps = await loadSnaps(symbol);
  const last = snaps[snaps.length - 1];
  if (!last || snap.ts - last.ts >= MIN_RESOLUTION_MS) snaps.push(snap);
  else snaps[snaps.length - 1] = snap;
  if (snaps.length > HISTORY_CAP) snaps = snaps.slice(-HISTORY_CAP);
  await saveSnaps(symbol, snaps);

  const tf: OCConfluence['tf'] = {} as any;
  for (const key of ['5m', '15m', '1h'] as const) {
    const prev = lookback(snaps, TF_MS[key]);
    tf[key] = prev ? scoreTF(direction, snap, prev, key)
      : { tf: key, priceChangePct: 0, callOIChangePct: 0, putOIChangePct: 0, pcrChange: 0, score: 50, verdict: `${key} warming up` };
  }

  const ocScore = Math.round(clamp(0.45 * tf['5m'].score + 0.35 * tf['15m'].score + 0.20 * tf['1h'].score));

  const prev5 = lookback(snaps, TF_MS['5m']) ?? snaps[0];
  const oiAction = classifyOI(direction, snap, prev5);
  const pcrTrend = tf['15m'].pcrChange > 0.03 ? 'RISING' : tf['15m'].pcrChange < -0.03 ? 'FALLING' : 'FLAT';
  const ivPrev = lookback(snaps, TF_MS['15m']);
  const ivTrend = ivPrev ? (snap.atmIV > ivPrev.atmIV * 1.03 ? 'RISING' : snap.atmIV < ivPrev.atmIV * 0.97 ? 'FALLING' : 'FLAT') : 'FLAT';
  const atmDelta = direction === 'CE' ? snap.atmCallDelta : snap.atmPutDelta;

  let entrySignal: OCEntrySignal = 'WAIT';
  if (ocScore >= 60 && tf['5m'].score >= 55 && tf['15m'].score >= 52) entrySignal = 'ENTER';
  else if (ocScore <= 38 || tf['5m'].score <= 35) entrySignal = 'AVOID';

  const notes: string[] = [];
  notes.push(`OI action: ${oiAction.replace('_', ' ').toLowerCase()}`);
  notes.push(tf['5m'].verdict);
  if (pcrTrend !== 'FLAT') notes.push(`PCR ${pcrTrend.toLowerCase()} (${snap.pcr.toFixed(2)})`);
  if (ivTrend !== 'FLAT') notes.push(`IV ${ivTrend.toLowerCase()}`);
  notes.push(`ATM delta ${atmDelta.toFixed(2)}`);

  const oiTxt = oiAction.replace('_', ' ').toLowerCase();
  let headline: string;
  if (entrySignal === 'ENTER') headline = `OPEN ${direction}: chain confirms - ${oiTxt}, ${tf['5m'].verdict}, ATM delta ${atmDelta.toFixed(2)}`;
  else if (entrySignal === 'AVOID') headline = `AVOID ${direction}: chain contradicts (${tf['5m'].verdict})`;
  else headline = `WAIT ${direction}: chain mixed (OC ${ocScore})`;

  return {
    symbol, direction, ocScore, oiAction,
    pcr: snap.pcr, pcrTrend, ivTrend, atmDelta,
    tf, entrySignal, headline, notes, updatedAt: snap.ts,
  };
}
