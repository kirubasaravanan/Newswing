/**
 * Universe Scanner - L1 Pre-Filter
 * 
 * Uses the comprehensive NSE stock list from nse-universe.ts (~600+ stocks)
 * and applies a lightweight L1 pre-filter to narrow down to candidates
 * before running the expensive V-Swing engine (L2).
 * 
 * L1 Pre-filter criteria (lightweight, can run on daily close data):
 *   1. Price > ₹50 (avoid penny stocks)
 *   2. Daily volume > 100K (minimum liquidity)
 *   3. Close > SMA 50 (basic uptrend)
 *   4. RSI(14) 40-75 (not overbought, not dead)
 *   5. Price > EMA 20 (recent bullish)
 *   6. ADX > 18 OR rising (trending market)
 */

import type { OHLCV } from './screening-engine';
import { SMA, EMA, RSI, ADX } from 'technicalindicators';
import { getFullNSEUniverse, getUniverseStats, type NSEStock } from './nse-universe';

// Re-export types for backward compatibility
export type { NSEStock } from './nse-universe';

// Legacy exports (empty - use getFullUniverse() instead)
export const NSE_FNO_STOCKS: NSEStock[] = [];
export const NSE_MIDCAP_STOCKS: NSEStock[] = [];

/**
 * Full universe = all NSE stocks from nse-universe.ts (~600+ deduped)
 * Covers: Nifty 50, Nifty 100, F&O, Mid-cap, Small-cap
 */
export function getFullUniverse(): NSEStock[] {
  return getFullNSEUniverse();
}

/** Get universe stats (count by category and sector) */
export { getUniverseStats };

// ── L1 Pre-Filter ─────────────────────────────────────────

export interface L1FilterResult {
  symbol: string;
  name: string;
  sector: string;
  category: string;
  passed: boolean;
  closePrice: number;
  sma50: number;
  ema20: number;
  rsi14: number;
  adx: number;
  dailyVolume: number;
  volumeMA20: number;
  failReason?: string;
}

/**
 * Lightweight L1 pre-filter.
 * Runs fast indicators (SMA50, EMA20, RSI14, ADX14) to eliminate
 * stocks that clearly don't have swing-trade potential.
 */
export function runL1Filter(
  symbol: string,
  name: string,
  sector: string,
  category: string,
  candles: OHLCV[]
): L1FilterResult | null {
  if (candles.length < 60) {
    return null;
  }

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);

  const currentClose = closes[closes.length - 1];
  const currentVolume = volumes[volumes.length - 1];

  // Filter 1: Minimum price ₹50
  if (currentClose < 50) {
    return { symbol, name, sector, category, passed: false, closePrice: currentClose, sma50: 0, ema20: 0, rsi14: 0, adx: 0, dailyVolume: currentVolume, volumeMA20: 0, failReason: 'Price < ₹50' };
  }

  const sma50Arr = SMA.calculate({ period: 50, values: closes });
  const ema20Arr = EMA.calculate({ period: 20, values: closes });
  const rsi14Arr = RSI.calculate({ period: 14, values: closes });
  const adxResult = ADX.calculate({ period: 14, high: highs, low: lows, close: closes });

  if (sma50Arr.length === 0 || ema20Arr.length === 0 || rsi14Arr.length === 0 || adxResult.length === 0) {
    return null;
  }

  const sma50 = sma50Arr[sma50Arr.length - 1];
  const ema20 = ema20Arr[ema20Arr.length - 1];
  const rsi14 = rsi14Arr[rsi14Arr.length - 1];
  const adxData = adxResult[adxResult.length - 1];
  const adx = adxData.adx;
  const prevAdx = adxResult.length > 1 ? adxResult[adxResult.length - 2].adx : 0;

  const recentVolumes = volumes.slice(-21);
  const volumeMA20 = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;

  const baseResult = {
    symbol, name, sector, category, passed: false,
    closePrice: currentClose, sma50, ema20, rsi14, adx,
    dailyVolume: currentVolume, volumeMA20,
  };

  if (currentVolume < 100000) {
    return { ...baseResult, failReason: `Low volume: ${(currentVolume / 1000).toFixed(0)}K` };
  }
  if (currentClose <= sma50) {
    return { ...baseResult, failReason: 'Below SMA 50' };
  }
  if (rsi14 < 35 || rsi14 > 80) {
    return { ...baseResult, failReason: `RSI ${rsi14.toFixed(1)} out of range` };
  }
  if (currentClose <= ema20) {
    return { ...baseResult, failReason: 'Below EMA 20' };
  }

  const adxRising = adx > prevAdx;
  if (adx < 14 && !adxRising) {
    return { ...baseResult, failReason: `Low ADX: ${adx.toFixed(1)}` };
  }

  return { ...baseResult, passed: true };
}