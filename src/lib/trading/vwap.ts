/**
 * Real Intraday VWAP (Volume-Weighted Average Price)
 *
 * Computed from real DhanHQ intraday minute candles for TODAY's session.
 *
 * LIVE-ONLY, by design: unlike market-structure.ts, this cannot be
 * meaningfully backtested with what this codebase has access to —
 * DhanHQ's historical intraday depth was not independently verified (the
 * token was rate-limit-blocked mid-development before this could be
 * checked against a live response), and even if available, retroactively
 * backtesting years of minute-level VWAP crossings is a materially bigger
 * data/compute undertaking than the daily-bar backtesting elsewhere in this
 * app. This function is for live entries only; it returns null (not a
 * fabricated value) whenever real intraday data isn't available.
 */
import { getDhanIntradayMinuteCandles } from './dhan-client';

export interface VWAPResult {
  vwap: number;
  currentPrice: number;
  aboveVWAP: boolean;
  distancePct: number;
}

export async function getTodayVWAP(
  symbol: string,
  targetEngine: 'INTRADAY_OPTIONS' | 'EQUITY_SWING' = 'INTRADAY_OPTIONS'
): Promise<VWAPResult | null> {
  try {
    const now = new Date();
    const istNow = new Date(now.getTime() + 5.5 * 3600_000 + now.getTimezoneOffset() * 60_000);
    const todayStr = istNow.toISOString().split('T')[0];
    const fromDate = `${todayStr} 09:15:00`;
    const toDate = `${todayStr} ${istNow.toTimeString().slice(0, 8)}`;

    const candles = await getDhanIntradayMinuteCandles(symbol, fromDate, toDate, '5', targetEngine);
    if (!candles.length) return null;

    let cumPV = 0;
    let cumVol = 0;
    for (const c of candles) {
      const typicalPrice = (c.high + c.low + c.close) / 3;
      cumPV += typicalPrice * c.volume;
      cumVol += c.volume;
    }
    if (cumVol <= 0) return null;

    const vwap = cumPV / cumVol;
    const currentPrice = candles[candles.length - 1].close;
    const distancePct = ((currentPrice - vwap) / vwap) * 100;

    return {
      vwap: Math.round(vwap * 100) / 100,
      currentPrice,
      aboveVWAP: currentPrice > vwap,
      distancePct: Math.round(distancePct * 100) / 100,
    };
  } catch {
    return null;
  }
}
