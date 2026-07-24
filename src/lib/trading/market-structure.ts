/**
 * Price-Action Market Structure Analysis
 *
 * Swing high/low detection, Break of Structure (BOS) / Change of Character
 * (CHoCH) classification, price-action support/resistance (prior day/week/
 * month highs/lows), liquidity-sweep (stop-hunt) detection, and Fair Value
 * Gap (FVG) detection — all computed from real historical daily OHLCV data
 * already fetched elsewhere in this codebase. No new data source required.
 *
 * Unlike the OI/VIX/Max-Pain factors in options-scanner.ts, everything in
 * this file CAN be backtested retroactively, since it only needs real
 * historical price/volume data (which we have years of via Yahoo/DhanHQ),
 * not a historical OI or VIX time-series (which we don't have).
 *
 * Note: these concepts (BOS/CHoCH/liquidity sweeps/FVG) are most commonly
 * applied on intraday timeframes. Adapted here to daily bars, since that's
 * the data this app has — a genuine scope simplification, stated plainly
 * rather than pretending this matches a 5-minute-chart implementation.
 */
import type { OHLCV } from './screening-engine';

export interface SwingPoint {
  index: number;
  date: string;
  price: number;
  type: 'HIGH' | 'LOW';
}

/**
 * Fractal-style swing point detection: a swing high is a bar whose high is
 * the unique highest within `lookback` bars on each side; symmetric for lows.
 */
export function findSwingPoints(candles: OHLCV[], lookback: number = 3): SwingPoint[] {
  const points: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const window = candles.slice(i - lookback, i + lookback + 1);
    const bar = candles[i];
    const isHigh = window.every(c => c.high <= bar.high) && window.filter(c => c.high === bar.high).length === 1;
    const isLow = window.every(c => c.low >= bar.low) && window.filter(c => c.low === bar.low).length === 1;
    if (isHigh) points.push({ index: i, date: bar.date, price: bar.high, type: 'HIGH' });
    if (isLow) points.push({ index: i, date: bar.date, price: bar.low, type: 'LOW' });
  }
  return points;
}

export type StructureState = 'UPTREND' | 'DOWNTREND' | 'RANGE' | 'UNKNOWN';

export interface MarketStructureResult {
  structure: StructureState;
  lastBOS: 'BULLISH' | 'BEARISH' | null;      // break of structure (trend continuation)
  lastCHoCH: 'BULLISH' | 'BEARISH' | null;    // change of character (early reversal signal)
  recentSwingHigh: number | null;
  recentSwingLow: number | null;
}

/**
 * Classifies market structure from the last few real swing points:
 *  - UPTREND: higher highs AND higher lows
 *  - DOWNTREND: lower highs AND lower lows
 *  - RANGE: mixed
 * BOS = price breaks beyond the most recent swing point IN the direction of
 * the existing trend (continuation). CHoCH = price breaks beyond a swing
 * point AGAINST the existing trend — the first real sign of a reversal, and
 * a much higher-conviction entry trigger than a plain EMA crossover when
 * combined with real OI/VIX confirmation.
 */
export function analyzeMarketStructure(candles: OHLCV[], currentPrice: number): MarketStructureResult {
  const swings = findSwingPoints(candles, 3);
  if (swings.length < 4) {
    return { structure: 'UNKNOWN', lastBOS: null, lastCHoCH: null, recentSwingHigh: null, recentSwingLow: null };
  }

  const highs = swings.filter(s => s.type === 'HIGH').slice(-3);
  const lows = swings.filter(s => s.type === 'LOW').slice(-3);

  let structure: StructureState = 'RANGE';
  if (highs.length >= 2 && lows.length >= 2) {
    const higherHighs = highs[highs.length - 1].price > highs[highs.length - 2].price;
    const higherLows = lows[lows.length - 1].price > lows[lows.length - 2].price;
    const lowerHighs = highs[highs.length - 1].price < highs[highs.length - 2].price;
    const lowerLows = lows[lows.length - 1].price < lows[lows.length - 2].price;
    if (higherHighs && higherLows) structure = 'UPTREND';
    else if (lowerHighs && lowerLows) structure = 'DOWNTREND';
  }

  const recentSwingHigh = highs.length ? highs[highs.length - 1].price : null;
  const recentSwingLow = lows.length ? lows[lows.length - 1].price : null;

  let lastBOS: 'BULLISH' | 'BEARISH' | null = null;
  let lastCHoCH: 'BULLISH' | 'BEARISH' | null = null;

  if (recentSwingHigh != null && currentPrice > recentSwingHigh) {
    if (structure === 'UPTREND') lastBOS = 'BULLISH';
    else if (structure === 'DOWNTREND') lastCHoCH = 'BULLISH';
  }
  if (recentSwingLow != null && currentPrice < recentSwingLow) {
    if (structure === 'DOWNTREND') lastBOS = 'BEARISH';
    else if (structure === 'UPTREND') lastCHoCH = 'BEARISH';
  }

  return { structure, lastBOS, lastCHoCH, recentSwingHigh, recentSwingLow };
}

// ── Price-Action Support/Resistance (prior day/week/month H/L) ──────────
export interface PriceActionLevels {
  prevDayHigh: number; prevDayLow: number;
  prevWeekHigh: number; prevWeekLow: number;
  prevMonthHigh: number; prevMonthLow: number;
}

export function getPriceActionLevels(candles: OHLCV[]): PriceActionLevels | null {
  if (candles.length < 22) return null;
  const prev = candles[candles.length - 2];
  const weekBars = candles.slice(-6, -1);   // ~5 trading days before today
  const monthBars = candles.slice(-22, -1); // ~21 trading days before today

  return {
    prevDayHigh: prev.high, prevDayLow: prev.low,
    prevWeekHigh: Math.max(...weekBars.map(c => c.high)),
    prevWeekLow: Math.min(...weekBars.map(c => c.low)),
    prevMonthHigh: Math.max(...monthBars.map(c => c.high)),
    prevMonthLow: Math.min(...monthBars.map(c => c.low)),
  };
}

/** Nearest real support level below `price` from swing points + price-action levels. */
export function nearestSupport(price: number, swings: SwingPoint[], levels: PriceActionLevels | null): number | null {
  const candidates: number[] = [];
  for (const s of swings) if (s.type === 'LOW' && s.price < price) candidates.push(s.price);
  if (levels) {
    if (levels.prevDayLow < price) candidates.push(levels.prevDayLow);
    if (levels.prevWeekLow < price) candidates.push(levels.prevWeekLow);
    if (levels.prevMonthLow < price) candidates.push(levels.prevMonthLow);
  }
  return candidates.length ? Math.max(...candidates) : null;
}

/** Nearest real resistance level above `price` from swing points + price-action levels. */
export function nearestResistance(price: number, swings: SwingPoint[], levels: PriceActionLevels | null): number | null {
  const candidates: number[] = [];
  for (const s of swings) if (s.type === 'HIGH' && s.price > price) candidates.push(s.price);
  if (levels) {
    if (levels.prevDayHigh > price) candidates.push(levels.prevDayHigh);
    if (levels.prevWeekHigh > price) candidates.push(levels.prevWeekHigh);
    if (levels.prevMonthHigh > price) candidates.push(levels.prevMonthHigh);
  }
  return candidates.length ? Math.min(...candidates) : null;
}

// ── Liquidity Sweep Detection (daily-bar adapted) ────────────────────────
// A "sweep" = today's bar takes out a recent swing low/high (stop hunt) but
// CLOSES back inside the prior range — often precedes a reversal, since it
// suggests weak hands got stopped out just before the real move.
export interface LiquiditySweepResult {
  sweptHigh: boolean;
  sweptLow: boolean;
}

export function detectLiquiditySweep(candles: OHLCV[], swings: SwingPoint[]): LiquiditySweepResult {
  const bar = candles[candles.length - 1];
  const recentHighs = swings.filter(s => s.type === 'HIGH');
  const recentLows = swings.filter(s => s.type === 'LOW');
  const recentHigh = recentHighs.length ? recentHighs[recentHighs.length - 1].price : undefined;
  const recentLow = recentLows.length ? recentLows[recentLows.length - 1].price : undefined;

  const sweptHigh = recentHigh != null && bar.high > recentHigh && bar.close < recentHigh;
  const sweptLow = recentLow != null && bar.low < recentLow && bar.close > recentLow;

  return { sweptHigh, sweptLow };
}

// ── Fair Value Gap (FVG) Detection ───────────────────────────────────────
// A 3-candle imbalance: candle 1's high < candle 3's low (bullish FVG — an
// unfilled gap that often acts as support on a pullback), or candle 1's low
// > candle 3's high (bearish FVG — acts as resistance).
export interface FVGResult {
  bullishFVG: { top: number; bottom: number } | null;
  bearishFVG: { top: number; bottom: number } | null;
}

export function detectFVG(candles: OHLCV[]): FVGResult {
  if (candles.length < 3) return { bullishFVG: null, bearishFVG: null };
  const n = candles.length;
  const c1 = candles[n - 3];
  const c3 = candles[n - 1];

  let bullishFVG: { top: number; bottom: number } | null = null;
  let bearishFVG: { top: number; bottom: number } | null = null;

  if (c1.high < c3.low) bullishFVG = { top: c3.low, bottom: c1.high };
  if (c1.low > c3.high) bearishFVG = { top: c1.low, bottom: c3.high };

  return { bullishFVG, bearishFVG };
}

// ── Structure-Based Adaptive Risk:Reward ─────────────────────────────────
// Replaces a flat -25%/+50% premium SL/TP with stop/target distances derived
// from REAL nearest support/resistance on the underlying. Split into two
// steps deliberately: the spot-distance calculation needs no option data at
// all (usable at scan time), while the conversion into a premium % needs the
// REAL fetched premium and real delta — which aren't known until the caller
// has actually pulled the live option chain. Do not fabricate a placeholder
// premium to collapse these into one step.

export interface StructureSpotDistances {
  stopSpotDistance: number;   // real ₹ distance on the underlying to the stop level
  targetSpotDistance: number; // real ₹ distance on the underlying to the target level
}

export function computeStructureSpotDistances(
  direction: 'CE' | 'PE',
  spot: number,
  swings: SwingPoint[],
  levels: PriceActionLevels | null
): StructureSpotDistances {
  const support = nearestSupport(spot, swings, levels);
  const resistance = nearestResistance(spot, swings, levels);

  let stopSpotDistance: number;
  let targetSpotDistance: number;

  if (direction === 'CE') {
    stopSpotDistance = support != null ? spot - support : spot * 0.01;
    targetSpotDistance = resistance != null ? Math.max(resistance - spot, stopSpotDistance * 2) : stopSpotDistance * 2;
  } else {
    stopSpotDistance = resistance != null ? resistance - spot : spot * 0.01;
    targetSpotDistance = support != null ? Math.max(spot - support, stopSpotDistance * 2) : stopSpotDistance * 2;
  }

  return { stopSpotDistance: Math.max(0.01, stopSpotDistance), targetSpotDistance: Math.max(0.01, targetSpotDistance) };
}

export interface StructureBasedTargets {
  stopLossPct: number;   // negative number, e.g. -22 means -22% from entry premium
  targetPct: number;     // positive number, e.g. 48 means +48% from entry premium
  riskRewardRatio: number;
}

/**
 * Converts real spot-distance targets into a premium % move via the
 * option's own real delta (first-order Greeks approximation — the standard
 * way to translate a spot move into an expected premium move without
 * repricing the full Black-Scholes chain at every candidate level). Requires
 * the REAL fetched entry premium — never call this with a placeholder.
 */
export function convertToPremiumTargets(
  distances: StructureSpotDistances,
  delta: number,
  entryPremium: number
): StructureBasedTargets {
  const absDelta = Math.max(0.15, Math.min(0.95, Math.abs(delta)));

  const rawStopPct = entryPremium > 0 ? (absDelta * distances.stopSpotDistance / entryPremium) * 100 : 25;
  const rawTargetPct = entryPremium > 0 ? (absDelta * distances.targetSpotDistance / entryPremium) * 100 : 50;

  const stopLossPct = -Math.max(15, Math.min(60, rawStopPct));
  const targetPct = Math.max(30, Math.min(150, rawTargetPct));

  return {
    stopLossPct,
    targetPct,
    riskRewardRatio: Math.round((targetPct / Math.abs(stopLossPct)) * 100) / 100,
  };
}
