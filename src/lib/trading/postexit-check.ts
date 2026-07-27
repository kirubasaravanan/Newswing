/**
 * Post-exit real price movement check — same idea ported from the Forex
 * engine's engine/postmortem.py this session: knowing WHY a trade exited
 * only answers half the question. This checks real market data for the
 * window after a trade closed to see whether price kept moving in the
 * trade's original direction (exited too early, left profit on the table)
 * or reversed against it (exit was justified).
 *
 * Equity and options need different windows and different underlyings:
 * - Equity swing trades move on a multi-day timescale — checks the next
 *   few real DAILY bars via getHistoricalData().
 * - Options are intraday and the option's own premium is confounded by
 *   time decay/IV, not a clean directional signal — checks the next few
 *   MINUTES of the real UNDERLYING's price instead (extracted from the
 *   composite trade symbol "SYMBOL_CE_STRIKE_EXPIRY" written by
 *   auto-trade/route.ts's tradeSymbol construction), cross-referenced
 *   against the option's own direction (CE=bullish underlying expected,
 *   PE=bearish).
 */
import { getHistoricalData } from './data-provider';
import { getDhanIntradayMinuteCandles } from './dhan-client';

export type PostExitVerdict = 'exited_early' | 'exit_justified_reversed' | 'exit_justified_sl_would_have_hit' | 'wash';

export interface PostExitMovement {
  status: 'ok' | 'window_not_elapsed_yet' | 'no_data_available';
  windowUnit: 'minutes' | 'trading_days';
  windowSize: number;
  minutesRemaining?: number;
  favorableMove?: number;
  adverseMove?: number;
  wouldHaveHitOriginalSL?: boolean;
  verdict?: PostExitVerdict;
}

function classify(
  favorableMove: number,
  adverseMove: number,
  wouldHaveHitSL: boolean
): PostExitVerdict {
  if (favorableMove > 0 && favorableMove > adverseMove) return 'exited_early';
  if (wouldHaveHitSL) return 'exit_justified_sl_would_have_hit';
  if (adverseMove > favorableMove) return 'exit_justified_reversed';
  return 'wash';
}

/** Equity — checks the next `windowDays` real daily bars after exit. */
export async function checkEquityPostExitMovement(
  trade: { symbol: string; direction: string; exitPrice: number | null; exitDate: string | null; stopLoss: number },
  windowDays = 3
): Promise<PostExitMovement | null> {
  if (!trade.exitDate || trade.exitPrice == null) return null;
  const exitDate = new Date(trade.exitDate);
  const now = new Date();
  const tradingDaysElapsed = (now.getTime() - exitDate.getTime()) / 86400000;
  if (tradingDaysElapsed < windowDays) {
    return {
      status: 'window_not_elapsed_yet',
      windowUnit: 'trading_days',
      windowSize: windowDays,
      minutesRemaining: Math.round((windowDays - tradingDaysElapsed) * 1440),
    };
  }

  const { data } = await getHistoricalData(trade.symbol, windowDays + 15);
  if (!data || data.length === 0) return { status: 'no_data_available', windowUnit: 'trading_days', windowSize: windowDays };

  const afterExit = data.filter((bar) => new Date(bar.date).getTime() > exitDate.getTime()).slice(0, windowDays);
  if (afterExit.length === 0) return { status: 'no_data_available', windowUnit: 'trading_days', windowSize: windowDays };

  const isLong = trade.direction === 'LONG';
  const highs = afterExit.map((b) => b.high);
  const lows = afterExit.map((b) => b.low);
  const bestFavorable = isLong ? Math.max(...highs) : Math.min(...lows);
  const worstAdverse = isLong ? Math.min(...lows) : Math.max(...highs);
  const favorableMove = isLong ? bestFavorable - trade.exitPrice : trade.exitPrice - bestFavorable;
  const adverseMove = isLong ? trade.exitPrice - worstAdverse : worstAdverse - trade.exitPrice;
  const wouldHaveHitSL = isLong ? worstAdverse <= trade.stopLoss : worstAdverse >= trade.stopLoss;

  return {
    status: 'ok',
    windowUnit: 'trading_days',
    windowSize: windowDays,
    favorableMove: Math.round(favorableMove * 100) / 100,
    adverseMove: Math.round(adverseMove * 100) / 100,
    wouldHaveHitOriginalSL: wouldHaveHitSL,
    verdict: classify(favorableMove, adverseMove, wouldHaveHitSL),
  };
}

/** Options — checks the next `windowMinutes` of the real UNDERLYING's
 * price (the option's own premium is a confounded signal; direction of
 * the underlying is what the trade was actually betting on). */
export async function checkOptionsPostExitMovement(
  trade: { symbol: string; direction: string; exitDate: string | null },
  windowMinutes = 30
): Promise<PostExitMovement | null> {
  if (!trade.exitDate) return null;
  const exitDate = new Date(trade.exitDate);
  const now = new Date();
  const minutesElapsed = (now.getTime() - exitDate.getTime()) / 60000;
  if (minutesElapsed < windowMinutes) {
    return {
      status: 'window_not_elapsed_yet',
      windowUnit: 'minutes',
      windowSize: windowMinutes,
      minutesRemaining: Math.round(windowMinutes - minutesElapsed),
    };
  }

  const underlying = trade.symbol.split('_')[0];
  const isBullish = trade.direction === 'CE' || trade.direction === 'BUY_CE';
  const windowEnd = new Date(exitDate.getTime() + windowMinutes * 60000);
  const fmt = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
  const candles = await getDhanIntradayMinuteCandles(underlying, fmt(exitDate), fmt(windowEnd), '5', 'INTRADAY_OPTIONS');
  if (!candles || candles.length === 0) return { status: 'no_data_available', windowUnit: 'minutes', windowSize: windowMinutes };

  const exitSpotPrice = candles[0].open;
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const bestFavorable = isBullish ? Math.max(...highs) : Math.min(...lows);
  const worstAdverse = isBullish ? Math.min(...lows) : Math.max(...highs);
  const favorableMove = isBullish ? bestFavorable - exitSpotPrice : exitSpotPrice - bestFavorable;
  const adverseMove = isBullish ? exitSpotPrice - worstAdverse : worstAdverse - exitSpotPrice;

  return {
    status: 'ok',
    windowUnit: 'minutes',
    windowSize: windowMinutes,
    favorableMove: Math.round(favorableMove * 100) / 100,
    adverseMove: Math.round(adverseMove * 100) / 100,
    wouldHaveHitOriginalSL: false, // not meaningful for the underlying vs. the option's own SL — premium-based, not underlying-price-based
    verdict: classify(favorableMove, adverseMove, false),
  };
}
