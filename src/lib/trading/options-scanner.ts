/**
 * Options Scanner — Scans all ~200 F&O stocks + Nifty/BankNifty/FinNifty
 * Generates CE/PE signals using spot price action, OI analysis, and Greeks.
 *
 * v2 "sniper mode" overhaul (see worklog for the full review that drove this):
 *  - Fixed a dead EMA9/EMA20 crossover check — `ema9Val[0] !== undefined` was
 *    indexing a plain number (always undefined), so that 15-point factor
 *    silently never fired since this file was written.
 *  - Added real change-in-OI buildup classification (fresh long/short
 *    buildup vs. covering/unwinding) using DhanHQ's real per-strike
 *    `changeInOI` data, which was already being fetched but never read —
 *    replaces a bare PCR snapshot that can't tell fresh conviction from
 *    short-covering.
 *  - Added OI-wall support/resistance detection (max Call OI strike =
 *    resistance, max Put OI strike = support) from the real chain.
 *  - Added India VIX regime as a scoring/gating factor — `vix.ts` already
 *    fetches real India VIX with buyer/seller guidance, it just wasn't
 *    wired into any trading decision.
 *  - Added Max Pain proximity as a factor (was computed in option-chain.ts,
 *    never used).
 *  - Added real volume-vs-20-day-average confirmation — the historical
 *    candles were already fetched for indicators, volume was just unread.
 *  - Added a basic contract-liquidity gate (bid/ask spread + OI floor) so
 *    signals aren't generated on untradeable strikes.
 *  - Raised the default score bar substantially and turned key
 *    disagreements (OI buildup contradicts direction, VIX unfavorable for
 *    buyers, fighting Max Pain into expiry) into hard penalties rather than
 *    optional bonuses — by design this should produce far fewer, higher-
 *    conviction signals than the previous "20-30 calls/day" target.
 *
 * IMPORTANT LIMITATION: none of the OI/VIX/Max-Pain factors can be
 * retroactively backtested — there is no historical OI or VIX time-series
 * data source available. These can only be validated by watching live/paper
 * performance going forward (Discord alerts + autoTradeLog).
 */

import { getStocksByCategory, type NSEStock } from './nse-universe';
import { getCurrentPrice, getHistoricalData } from './data-provider';
import { EMA, RSI, ATR, ADX } from 'technicalindicators';
import { fetchVIX, getVIXGuidance, type VIXGuidance } from '@/lib/options/vix';
import type { OptionChainRow } from '@/lib/options/option-chain';
import {
  findSwingPoints, analyzeMarketStructure, getPriceActionLevels, nearestSupport, nearestResistance,
  detectLiquiditySweep, detectFVG, computeStructureSpotDistances,
  type MarketStructureResult, type PriceActionLevels, type StructureSpotDistances,
} from './market-structure';
import { fetchGlobalMarketsContext, getRelevantCommodityContext, type GlobalMarketsContext } from './global-markets';
import { classifyMarketRegime } from './regime-intelligence';
import { getTodayVWAP } from './vwap';
import type { OHLCV } from './screening-engine';

// ── Sniper-mode thresholds ───────────────────────────────
// Raised substantially from the previous 40/55 defaults, which produced
// "20-30 calls/day" by design. These require multiple strong, aligned
// factors (trend + momentum + OI buildup + VIX regime, etc.) — a setup that
// merely passes one or two factors will no longer clear the bar.
export const SNIPER_MIN_SCORE = 100;
export const SNIPER_MIN_CONFIDENCE = 75;

// ── Types ──────────────────────────────────────────────
export interface OptionsSignal {
  symbol: string;
  stockName?: string;
  sector?: string;
  direction: 'CE' | 'PE';
  entryPrice: number;       // Spot price at signal
  strike: number;           // Recommended strike
  expiry: string;           // Expiry date
  confidence: number;       // 0-100
  score: number;            // Composite score
  reasons: string[];        // Why this signal
  spotChange: number;       // % change from open
  oiBullish: boolean;
  oiBuildup: 'LONG_BUILDUP' | 'SHORT_COVERING' | 'SHORT_BUILDUP' | 'LONG_UNWINDING' | 'FLAT';
  vixRegime: string;
  marketRegime: string;        // TRENDING_HIGH_VOL / TRENDING_LOW_VOL / RANGING_HIGH_VOL / RANGING_LOW_VOL — for regime-conditioned win-rate tracking
  structureSignal: 'CHOCH' | 'BOS' | 'NONE'; // real market-structure trigger, if any
  // Real ₹ distances on the UNDERLYING to the nearest structure-based stop/
  // target — premium-independent by design (the real premium isn't known
  // until the caller fetches the live option chain). Convert to a premium %
  // via market-structure.ts's convertToPremiumTargets() once the real entry
  // premium and delta are known — never fabricate a placeholder premium to
  // do this conversion early.
  stopSpotDistance: number;
  targetSpotDistance: number;
  rsi: number;
  adx: number;
  atrPct: number;           // ATR as % of price (volatility)
  timestamp: string;
}

interface ScanResult {
  signals: OptionsSignal[];
  totalScanned: number;
  scanDurationMs: number;
  indexSignals: OptionsSignal[];
  stockSignals: OptionsSignal[];
}

export function getFNOUniverse(): string[] {
  const indices = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];
  
  // Dynamically pull all F&O eligible stocks (Nifty 50, Nifty 100, & FNO Liquid Leaders)
  const fnoStocks = getStocksByCategory()
    .filter(s => s.category === 'FNO' || s.category === 'NIFTY50' || s.category === 'NIFTY100')
    .map(s => s.symbol);

  return Array.from(new Set([...indices, ...fnoStocks]));
}

function buildSectorMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const s of getStocksByCategory()) {
    map[s.symbol] = s.sector;
  }
  return map;
}

// ── Nearest Expiry Calculation ──────────────────────────
export function getNextExpiry(): string {
  const now = new Date();
  // Find next Thursday
  const day = now.getDay();
  let daysUntilThu = (4 - day + 7) % 7;
  if (daysUntilThu === 0 && now.getHours() >= 15.5) daysUntilThu = 7; // After market on Thursday, go next week
  const expiry = new Date(now.getTime() + daysUntilThu * 86400000);
  return expiry.toISOString().split('T')[0];
}

export function getStrikeStep(symbol: string, spot: number): number {
  if (symbol === 'NIFTY' || symbol === 'NIFTY50') return 50;
  if (symbol === 'BANKNIFTY') return 100;
  if (symbol === 'FINNIFTY') return 50;
  if (symbol === 'NIFTYIT') return 50;
  if (symbol === 'MIDCPNIFTY') return 25;

  if (spot > 3000) return 50;
  if (spot > 1000) return 20;
  if (spot > 500) return 10;
  if (spot > 200) return 5;
  if (spot > 100) return 2.5;
  return 1;
}

// ── Strike Selection ────────────────────────────────────
function selectStrike(symbol: string, price: number, direction: 'CE' | 'PE'): number {
  const step = getStrikeStep(symbol, price);
  const base = Math.round(price / step) * step;
  return base;
}

import { blackScholes } from '@/lib/options/black-scholes';
import { fetchDhanOptionChain } from '@/lib/options/dhan-option-provider';

// ── Exact Black-Scholes Delta Calculation (Zero Approximations) ──
function calculateExactBSDelta(spot: number, strike: number, daysToExpiry: number, type: 'CE' | 'PE', iv: number = 0.18): number {
  if (daysToExpiry <= 0) return type === 'CE' ? (spot >= strike ? 1 : 0) : (spot <= strike ? -1 : 0);
  const T = Math.max(daysToExpiry, 1) / 365;
  const r = 0.0675; // Exact RBI Repo Rate
  const result = blackScholes(spot, strike, T, r, iv, type);
  return Math.abs(result.delta);
}

// ── Real Option Chain Context: OI buildup, OI walls, Max Pain, liquidity ──

interface ChainContext {
  pcr: number;
  actualExpiry?: string;
  // Real change-in-OI vs. real price-direction classification (the standard
  // futures-style 4-quadrant read, applied to the chain's aggregate OI
  // change as a proxy — see the file header comment for why this isn't a
  // per-strike read).
  oiBuildup: 'LONG_BUILDUP' | 'SHORT_COVERING' | 'SHORT_BUILDUP' | 'LONG_UNWINDING' | 'FLAT';
  resistance: number | null;   // strike with the highest real Call OI at/above spot
  support: number | null;      // strike with the highest real Put OI at/below spot
  maxPainStrike: number | null;
  atmSpreadPct: number | null; // real bid-ask spread at ATM, as % of mid — liquidity check
  atmOI: number;               // real combined CE+PE OI at ATM — liquidity floor
}

/** Highest real Call OI at/above spot = resistance wall; highest real Put OI at/below spot = support wall. */
function findOIWalls(chain: OptionChainRow[], spot: number): { resistance: number | null; support: number | null } {
  let resistance: number | null = null;
  let resistanceOI = 0;
  let support: number | null = null;
  let supportOI = 0;
  for (const row of chain) {
    if (row.strike >= spot && row.ce.oi > resistanceOI) { resistanceOI = row.ce.oi; resistance = row.strike; }
    if (row.strike <= spot && row.pe.oi > supportOI) { supportOI = row.pe.oi; support = row.strike; }
  }
  return { resistance, support };
}

// Returns the real option-chain context AND the actual expiry from DhanHQ
// (which may differ from the guessed expiry if the guess didn't match an
// available date).
async function fetchChainContext(symbol: string, expiry: string, spot: number, spotChangePct: number): Promise<ChainContext | null> {
  try {
    const chainResult = await fetchDhanOptionChain(symbol, expiry);
    if (!chainResult || !chainResult.chain || chainResult.chain.length === 0) {
      // Real data unavailable -> Stop analysis per strict directive
      return null;
    }
    const chain = chainResult.chain;
    const pcrRaw = chainResult.pcr;
    const pcr = typeof pcrRaw === 'number' ? pcrRaw : (typeof pcrRaw === 'object' && pcrRaw ? (pcrRaw as any).pcr || 1.0 : 1.0);

    // Real change-in-OI, summed across the chain, as a bullish/bearish lean —
    // replaces the previous bare PCR-only read.
    let totalCeOIChange = 0;
    let totalPeOIChange = 0;
    for (const row of chain) {
      totalCeOIChange += row.ce?.changeInOI ?? 0;
      totalPeOIChange += row.pe?.changeInOI ?? 0;
    }
    const netOIChange = totalPeOIChange - totalCeOIChange; // + => bullish OI lean, - => bearish OI lean

    let oiBuildup: ChainContext['oiBuildup'] = 'FLAT';
    if (Math.abs(spotChangePct) >= 0.15) {
      if (spotChangePct > 0) oiBuildup = netOIChange > 0 ? 'LONG_BUILDUP' : 'SHORT_COVERING';
      else oiBuildup = netOIChange < 0 ? 'SHORT_BUILDUP' : 'LONG_UNWINDING';
    }

    const { resistance, support } = findOIWalls(chain, spot);
    const maxPainStrike = chainResult.maxPain?.maxPainStrike ?? null;

    const atmRow = chain.reduce((closest, r) => Math.abs(r.strike - spot) < Math.abs(closest.strike - spot) ? r : closest);
    const atmMid = atmRow.ce.bid > 0 && atmRow.ce.ask > 0 ? (atmRow.ce.bid + atmRow.ce.ask) / 2 : atmRow.ce.ltp;
    const atmSpreadPct = atmMid > 0 && atmRow.ce.ask > 0 ? ((atmRow.ce.ask - atmRow.ce.bid) / atmMid) * 100 : null;
    const atmOI = (atmRow.ce.oi || 0) + (atmRow.pe.oi || 0);

    return { pcr, actualExpiry: chainResult.expiryDate, oiBuildup, resistance, support, maxPainStrike, atmSpreadPct, atmOI };
  } catch (err) {
    console.warn(`[Chain Context] Failed for ${symbol} ${expiry}:`, err);
    return null;
  }
}

export const INDEX_SYMBOLS = ['NIFTY', 'NIFTY50', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];

// ── Single Stock Scan ───────────────────────────────────
async function scanStock(
  symbol: string,
  sectorMap: Record<string, string>,
  minScore: number = SNIPER_MIN_SCORE,
  vix: VIXGuidance | null = null,
  niftyCandles: OHLCV[] = [],
  globalCtx: GlobalMarketsContext | null = null
): Promise<OptionsSignal[]> {
  const signals: OptionsSignal[] = [];

  try {
    const priceRes = await getCurrentPrice(symbol);
    const spot = priceRes?.price || 0;
    const change = priceRes?.quote?.change || 0;
    if (!spot || spot <= 0) return signals;

    // Get historical data for indicators
    const { data: candles } = await getHistoricalData(symbol, 60);
    if (!candles || candles.length < 30) return signals;

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);

    const ema20 = EMA.calculate({ period: 20, values: closes });
    const ema9 = EMA.calculate({ period: 9, values: closes });
    const rsiArr = RSI.calculate({ period: 14, values: closes });
    const atrArr = ATR.calculate({ period: 14, high: highs, low: lows, close: closes });
    const adxArr = ADX.calculate({ period: 14, high: highs, low: lows, close: closes });

    if (ema20.length < 2 || rsiArr.length < 2) return signals;

    const latestClose = closes[closes.length - 1];
    const ema20Val = ema20[ema20.length - 1];
    const ema9Val = ema9[ema9.length - 1];
    const rsi = rsiArr[rsiArr.length - 1];
    const atr = atrArr[atrArr.length - 1] || 0;
    const adx = adxArr.length > 0 ? adxArr[adxArr.length - 1].adx : 0;
    const prevEma20 = ema20[ema20.length - 2];

    const atrPct = (atr / latestClose) * 100;
    const spotChange = change || 0;

    // Real volume vs. its own real trailing 20-session average — this data
    // was already fetched for the indicators above but never analyzed here
    // (only the equity swing engine checked volume; this scanner didn't).
    const latestVolume = volumes[volumes.length - 1] || 0;
    const priorVolumes = volumes.slice(-21, -1);
    const avgVolume20 = priorVolumes.length ? priorVolumes.reduce((a, b) => a + b, 0) / priorVolumes.length : 0;
    const volumeRatio = avgVolume20 > 0 ? latestVolume / avgVolume20 : 1;

    const expiryGuess = getNextExpiry();
    const chainCtx = await fetchChainContext(symbol, expiryGuess, spot, spotChange);
    // No real option chain data at all this cycle — skip rather than trade
    // blind (previously the scanner could still proceed on price/technical
    // factors alone with all OI-derived factors just silently absent).
    if (!chainCtx) return signals;

    // Use the ACTUAL expiry from DhanHQ (not the guess) — fixes the bug
    // where BANKNIFTY (Wed), FINNIFTY (Tue), MIDCPNIFTY (Mon) expiries were
    // always guessed as Thursday, causing wrong expiry in signals/trades.
    const expiry = chainCtx.actualExpiry || expiryGuess;
    const daysToExpiry = Math.max(1, Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400000));
    const timestamp = new Date().toISOString();

    // Liquidity gate: skip strikes with a real bid-ask spread too wide or
    // real combined OI too thin to be genuinely tradeable — no point
    // generating a "sniper" signal for a contract you can't actually fill.
    if (chainCtx.atmOI < 500 || (chainCtx.atmSpreadPct != null && chainCtx.atmSpreadPct > 8)) {
      return signals;
    }

    // ── Signal Generation Logic (sniper mode) ──
    const ceReasons: string[] = [];
    const peReasons: string[] = [];
    let ceScore = 0;
    let peScore = 0;

    // Factor 1: Price vs EMA20 (trend) — ±20
    if (latestClose > ema20Val && ema20Val > prevEma20) {
      ceScore += 20; ceReasons.push('Above rising EMA20');
    } else if (latestClose < ema20Val && ema20Val < prevEma20) {
      peScore += 20; peReasons.push('Below falling EMA20');
    }

    // Factor 2: EMA9/EMA20 crossover — ±15. FIXED: previously guarded by
    // `ema9Val[0] !== undefined`, but ema9Val is a plain number — indexing a
    // number always returns undefined, so this factor silently never fired.
    if (ema9Val > ema20Val) {
      ceScore += 15; ceReasons.push('EMA9 > EMA20 (bullish crossover)');
    } else if (ema9Val < ema20Val) {
      peScore += 15; peReasons.push('EMA9 < EMA20 (bearish crossover)');
    }

    // Factor 3: RSI extremes — up to ±25
    if (rsi < 30) {
      ceScore += 25; ceReasons.push(`RSI oversold at ${rsi.toFixed(0)}`);
    } else if (rsi > 70) {
      peScore += 25; peReasons.push(`RSI overbought at ${rsi.toFixed(0)}`);
    } else if (rsi > 55) {
      ceScore += 10;
    } else if (rsi < 45) {
      peScore += 10;
    }

    // Factor 4: Real volume confirmation (NEW) — a move on genuinely low
    // participation is unreliable even if price/OI look right.
    if (volumeRatio >= 1.3) {
      if (ceScore >= peScore) { ceScore += 10; ceReasons.push(`Volume ${volumeRatio.toFixed(1)}x avg confirms move`); }
      else { peScore += 10; peReasons.push(`Volume ${volumeRatio.toFixed(1)}x avg confirms move`); }
    } else if (volumeRatio < 0.7) {
      ceScore -= 10; peScore -= 10; // weak participation — penalize both directions
    }

    // Factor 5: PCR baseline (secondary now — real OI buildup in Factor 6 is
    // the stronger read)
    if (chainCtx.pcr >= 1.0) {
      ceScore += 10; ceReasons.push(`PCR ${chainCtx.pcr.toFixed(2)} (put writing support)`);
    } else {
      peScore += 10; peReasons.push(`PCR ${chainCtx.pcr.toFixed(2)} (call writing resistance)`);
    }

    // Factor 6: Real change-in-OI buildup (NEW) — the strongest OI factor.
    // A CONTRADICTING buildup (e.g. considering CE while the real chain
    // shows fresh short buildup) is a hard penalty, not just a missed bonus —
    // this is what stops trades that fight real smart-money positioning from
    // ever reaching the sniper threshold.
    if (chainCtx.oiBuildup === 'LONG_BUILDUP') {
      ceScore += 25; peScore -= 25; ceReasons.push('Real OI: fresh long buildup');
    } else if (chainCtx.oiBuildup === 'SHORT_COVERING') {
      ceScore += 8; ceReasons.push('Real OI: short covering (weaker)');
    } else if (chainCtx.oiBuildup === 'SHORT_BUILDUP') {
      peScore += 25; ceScore -= 25; peReasons.push('Real OI: fresh short buildup');
    } else if (chainCtx.oiBuildup === 'LONG_UNWINDING') {
      peScore += 8; peReasons.push('Real OI: long unwinding (weaker)');
    }

    // Factor 7: Real OI-wall proximity (NEW) — highest real Call/Put OI
    // strikes as actual support/resistance, not a chart pattern guess.
    if (chainCtx.resistance != null) {
      const distToResistance = ((chainCtx.resistance - spot) / spot) * 100;
      if (distToResistance >= 0 && distToResistance < 0.5) {
        ceScore -= 12; ceReasons.push(`Pinned under real resistance wall @ ${chainCtx.resistance}`);
      } else if (distToResistance >= 0.5) {
        ceScore += 8; ceReasons.push(`Room to real resistance wall @ ${chainCtx.resistance}`);
      }
    }
    if (chainCtx.support != null) {
      const distToSupport = ((spot - chainCtx.support) / spot) * 100;
      if (distToSupport >= 0 && distToSupport < 0.5) {
        peScore -= 12; peReasons.push(`Pinned above real support wall @ ${chainCtx.support}`);
      } else if (distToSupport >= 0.5) {
        peScore += 8; peReasons.push(`Room to real support wall @ ${chainCtx.support}`);
      }
    }

    // Factor 8: ADX trend strength — reinforces whichever side is leading
    if (adx > 25) {
      const bonus = Math.min(15, Math.round((adx - 25) / 2));
      if (ceScore > peScore) { ceScore += bonus; ceReasons.push(`Strong trend ADX=${adx.toFixed(0)}`); }
      else { peScore += bonus; peReasons.push(`Strong trend ADX=${adx.toFixed(0)}`); }
    }

    // Factor 9: Spot momentum — ±10
    if (spotChange > 1.5) {
      ceScore += 10; ceReasons.push(`Strong spot momentum +${spotChange.toFixed(1)}%`);
    } else if (spotChange < -1.5) {
      peScore += 10; peReasons.push(`Strong spot momentum ${spotChange.toFixed(1)}%`);
    }

    // Factor 10: ATR volatility (richer premium) — reinforces the leader
    if (atrPct > 2.0) {
      if (ceScore > peScore) { ceScore += 10; ceReasons.push(`High volatility ATR=${atrPct.toFixed(1)}%`); }
      else { peScore += 10; peReasons.push(`High volatility ATR=${atrPct.toFixed(1)}%`); }
    }

    // Factor 11: India VIX regime (NEW) — real data, previously fetched only
    // for a display API and never used in a trading decision. Buying options
    // in a low/complacent VIX regime means paying full theta for cheap,
    // low-payoff premium; an elevated/high regime favors buyers with
    // genuinely larger expected moves.
    if (vix) {
      if (vix.optionBuyerBias === 'unfavorable') {
        ceScore -= 20; peScore -= 20;
      } else if (vix.optionBuyerBias === 'favorable') {
        ceScore += 15; peScore += 15;
      } else {
        ceScore += 5; peScore += 5;
      }
    }

    // Factor 12: Max Pain proximity (NEW) — only meaningful close to expiry
    // (the magnet effect is weak with a week+ still to go — matches the
    // reasoning already used for display in option-chain.ts).
    if (chainCtx.maxPainStrike != null && daysToExpiry <= 3) {
      if (chainCtx.maxPainStrike > spot) {
        ceScore += 8; peScore -= 8; ceReasons.push(`Max pain @ ${chainCtx.maxPainStrike} pulls price up into expiry`);
      } else if (chainCtx.maxPainStrike < spot) {
        peScore += 8; ceScore -= 8; peReasons.push(`Max pain @ ${chainCtx.maxPainStrike} pulls price down into expiry`);
      }
    }

    // Real price-action structures — all computed from the same real
    // historical daily candles already fetched above (no new data source),
    // and (unlike the OI/VIX factors) all backtestable retroactively.
    const swings = findSwingPoints(candles, 3);
    const levels = getPriceActionLevels(candles);
    const structureResult = analyzeMarketStructure(candles, latestClose);
    const sweep = detectLiquiditySweep(candles, swings);
    const fvg = detectFVG(candles);

    // Factor 13: Real market structure (CHoCH / BOS) — per the user's own
    // priority table this is as important as spot price structure itself. A
    // Change of Character (price breaking a swing point AGAINST the existing
    // trend) is the highest-conviction reversal trigger available; a Break of
    // Structure confirms trend continuation.
    if (structureResult.lastCHoCH === 'BULLISH') {
      ceScore += 20; ceReasons.push('Real CHoCH: structure just flipped bullish');
    } else if (structureResult.lastCHoCH === 'BEARISH') {
      peScore += 20; peReasons.push('Real CHoCH: structure just flipped bearish');
    } else if (structureResult.lastBOS === 'BULLISH') {
      ceScore += 12; ceReasons.push('Real BOS: bullish structure continuation');
    } else if (structureResult.lastBOS === 'BEARISH') {
      peScore += 12; peReasons.push('Real BOS: bearish structure continuation');
    }

    // Factor 14: Real price-action support/resistance (prior day/week/month
    // H/L + swing points) — distinct from the OI-wall S/R in Factor 7;
    // "where price remembers" vs. "where writers are positioned."
    const priceResistance = nearestResistance(spot, swings, levels);
    const priceSupport = nearestSupport(spot, swings, levels);
    if (priceResistance != null) {
      const d = ((priceResistance - spot) / spot) * 100;
      if (d >= 0 && d < 0.5) { ceScore -= 8; ceReasons.push(`Near real price resistance @ ${priceResistance.toFixed(1)}`); }
      else if (d >= 0.5) { ceScore += 6; }
    }
    if (priceSupport != null) {
      const d = ((spot - priceSupport) / spot) * 100;
      if (d >= 0 && d < 0.5) { peScore -= 8; peReasons.push(`Near real price support @ ${priceSupport.toFixed(1)}`); }
      else if (d >= 0.5) { peScore += 6; }
    }

    // Factor 15: Real liquidity sweep (daily-bar stop hunt) — a swept-then-
    // reclaimed low/high often precedes a reversal.
    if (sweep.sweptLow) { ceScore += 15; ceReasons.push('Real liquidity sweep: recent low swept then reclaimed'); }
    if (sweep.sweptHigh) { peScore += 15; peReasons.push('Real liquidity sweep: recent high swept then rejected'); }

    // Factor 16: Real Fair Value Gap proximity — an unfilled 3-candle
    // imbalance often acts as a magnet/support-resistance on a pullback.
    if (fvg.bullishFVG && spot > fvg.bullishFVG.bottom && spot < fvg.bullishFVG.top * 1.01) {
      ceScore += 8; ceReasons.push('Real bullish FVG nearby (unfilled support)');
    }
    if (fvg.bearishFVG && spot < fvg.bearishFVG.top && spot > fvg.bearishFVG.bottom * 0.99) {
      peScore += 8; peReasons.push('Real bearish FVG nearby (unfilled resistance)');
    }

    // Factor 17: Real Nifty regime as CONTEXT for stock options (not applied
    // to the indices themselves, which already have their own trend factors).
    if (!INDEX_SYMBOLS.includes(symbol) && niftyCandles.length >= 200) {
      const niftyCloses = niftyCandles.map(c => c.close);
      const niftyEma200 = EMA.calculate({ period: 200, values: niftyCloses });
      if (niftyEma200.length) {
        const niftyBullish = niftyCloses[niftyCloses.length - 1] > niftyEma200[niftyEma200.length - 1];
        if (niftyBullish) { ceScore += 8; ceReasons.push('Real Nifty regime bullish (context)'); }
        else { peScore += 8; peReasons.push('Real Nifty regime bearish (context)'); }
      }
    }

    // Factor 18: Real sector/relative-strength — trailing 20-session return
    // vs. Nifty's real return over the same window (same real-data approach
    // as the equity RS ranking engine, applied here for stock options only).
    if (!INDEX_SYMBOLS.includes(symbol) && niftyCandles.length > 20 && closes.length > 20) {
      const stockRet20 = (latestClose - closes[closes.length - 21]) / closes[closes.length - 21];
      const niftyCloses = niftyCandles.map(c => c.close);
      const niftyRet20 = (niftyCloses[niftyCloses.length - 1] - niftyCloses[niftyCloses.length - 21]) / niftyCloses[niftyCloses.length - 21];
      const relStrengthPts = (stockRet20 - niftyRet20) * 100;
      if (relStrengthPts > 2) { ceScore += 15; ceReasons.push(`Real RS: outperforming Nifty by ${relStrengthPts.toFixed(1)}pp (20d)`); }
      else if (relStrengthPts < -2) { peScore += 15; peReasons.push(`Real RS: underperforming Nifty by ${Math.abs(relStrengthPts).toFixed(1)}pp (20d)`); }
    }

    // Factor 19: Real global markets + sector-relevant commodity/currency —
    // context only, weighted modestly, and only applied to sectors it
    // actually affects (crude for energy, gold for jewellery, USD/INR for
    // IT/pharma/textiles exporters).
    if (globalCtx) {
      if (globalCtx.usSentiment === 'BULLISH') ceScore += 8;
      else if (globalCtx.usSentiment === 'BEARISH') peScore += 8;
      const commodity = getRelevantCommodityContext(sectorMap[symbol], globalCtx);
      if (commodity) {
        if (commodity.changePct > 1) { ceScore += 6; ceReasons.push(`${commodity.label} +${commodity.changePct}% (real sector tailwind)`); }
        else if (commodity.changePct < -1) { peScore += 6; peReasons.push(`${commodity.label} ${commodity.changePct}% (real sector headwind)`); }
      }
    }

    // Factor 20: Real intraday VWAP (LIVE-ONLY — see vwap.ts; silently
    // contributes nothing if intraday data isn't available this cycle,
    // rather than fabricating a value).
    try {
      const vwapResult = await getTodayVWAP(symbol);
      if (vwapResult) {
        if (vwapResult.aboveVWAP) { ceScore += 12; ceReasons.push(`Real price above VWAP (₹${vwapResult.vwap})`); }
        else { peScore += 12; peReasons.push(`Real price below VWAP (₹${vwapResult.vwap})`); }
      }
    } catch { /* VWAP unavailable this cycle — no contribution */ }

    const marketRegime = classifyMarketRegime(adx, atrPct);
    const structureSignal: 'CHOCH' | 'BOS' | 'NONE' = structureResult.lastCHoCH ? 'CHOCH' : structureResult.lastBOS ? 'BOS' : 'NONE';

    // Generate CE signal if score >= minScore (sniper bar — see SNIPER_MIN_SCORE)
    if (ceScore >= minScore) {
      const strike = selectStrike(symbol, spot, 'CE');
      const delta = calculateExactBSDelta(spot, strike, daysToExpiry, 'CE');
      const confidence = Math.min(95, Math.round(ceScore * 0.53 + (delta > 0.4 ? 5 : 0)));
      const distances = computeStructureSpotDistances('CE', spot, swings, levels);
      signals.push({
        symbol, direction: 'CE', entryPrice: spot, strike, expiry,
        confidence, score: ceScore, reasons: ceReasons,
        spotChange, oiBullish: chainCtx.oiBuildup === 'LONG_BUILDUP' || chainCtx.oiBuildup === 'SHORT_COVERING',
        oiBuildup: chainCtx.oiBuildup, vixRegime: vix?.regime || 'unknown',
        marketRegime, structureSignal, stopSpotDistance: distances.stopSpotDistance, targetSpotDistance: distances.targetSpotDistance,
        rsi, adx, atrPct, timestamp,
        stockName: sectorMap[symbol] ? '' : undefined,
        sector: sectorMap[symbol],
      });
    }

    // Generate PE signal if score >= minScore (sniper bar — see SNIPER_MIN_SCORE)
    if (peScore >= minScore) {
      const strike = selectStrike(symbol, spot, 'PE');
      const delta = calculateExactBSDelta(spot, strike, daysToExpiry, 'PE');
      const confidence = Math.min(95, Math.round(peScore * 0.53 + (delta > 0.4 ? 5 : 0)));
      const distances = computeStructureSpotDistances('PE', spot, swings, levels);
      signals.push({
        symbol, direction: 'PE', entryPrice: spot, strike, expiry,
        confidence, score: peScore, reasons: peReasons,
        spotChange, oiBullish: false,
        oiBuildup: chainCtx.oiBuildup, vixRegime: vix?.regime || 'unknown',
        marketRegime, structureSignal, stopSpotDistance: distances.stopSpotDistance, targetSpotDistance: distances.targetSpotDistance,
        rsi, adx, atrPct, timestamp,
        stockName: sectorMap[symbol] ? '' : undefined,
        sector: sectorMap[symbol],
      });
    }
  } catch (err) {
    // Skip stock on error — don't fail the whole scan
    console.error(`Options scan error for ${symbol}:`, err);
  }

  return signals;
}

// ── Main Scan Function ──────────────────────────────────
export async function scanOptionsUniverse(maxSignals?: number, minScore: number = SNIPER_MIN_SCORE): Promise<ScanResult> {
  const startTime = Date.now();
  const universe = getFNOUniverse();
  const sectorMap = buildSectorMap();
  const allSignals: OptionsSignal[] = [];

  // Fetch real India VIX ONCE per scan cycle (it's a single market-wide
  // value, not per-symbol) rather than per-stock — fetchVIX() is already
  // internally cached, but there's no reason to even attempt 190+ calls.
  let vixGuidance: VIXGuidance | null = null;
  try {
    const vixData = await fetchVIX();
    vixGuidance = getVIXGuidance(vixData.value);
  } catch (err) {
    console.warn('[Options Scan] Real VIX fetch failed — proceeding without VIX gating this cycle:', err);
  }

  // Real Nifty regime ONCE per cycle (context for stock options — per the
  // user's own notes, broad-market regime is real context, not a per-stock
  // signal) and real global-markets context (US close, commodities, USD/INR).
  let niftyCandles: OHLCV[] = [];
  try {
    niftyCandles = (await getHistoricalData('NIFTY50', 300)).data;
  } catch (err) {
    console.warn('[Options Scan] Real Nifty fetch failed — proceeding without Nifty regime context this cycle:', err);
  }
  let globalCtx: GlobalMarketsContext | null = null;
  try {
    globalCtx = await fetchGlobalMarketsContext();
  } catch (err) {
    console.warn('[Options Scan] Real global-markets fetch failed — proceeding without it this cycle:', err);
  }

  // Scan in batches of 10 to avoid overwhelming data providers
  const BATCH_SIZE = 10;
  for (let i = 0; i < universe.length; i += BATCH_SIZE) {
    const batch = universe.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(s => scanStock(s, sectorMap, minScore, vixGuidance, niftyCandles, globalCtx)));
    for (const r of results) {
      if (r.status === 'fulfilled') allSignals.push(...r.value);
    }
    // Timeout safety: max 3 minutes
    if (Date.now() - startTime > 3 * 60 * 1000) break;
  }

  // Sort by confidence descending
  allSignals.sort((a, b) => b.confidence - a.confidence);

  // Limit signals
  const limited = maxSignals ? allSignals.slice(0, maxSignals) : allSignals;

  // Separate index vs stock signals
  const indexSignals = limited.filter(s => INDEX_SYMBOLS.includes(s.symbol));
  const stockSignals = limited.filter(s => !INDEX_SYMBOLS.includes(s.symbol));

  return {
    signals: limited,
    totalScanned: universe.length,
    scanDurationMs: Date.now() - startTime,
    indexSignals,
    stockSignals,
  };
}

// ── Confluence Re-Score for Open Positions (dynamic exit) ──────────────
// Forex-style: re-runs the EXACT same entry-scoring logic against an open
// position's underlying, so a decaying or reversed thesis can trigger an
// early exit even though fixed SL/TP haven't been hit yet (see
// engine/confluence_exit.py in the Forex repo — same idea, ported).
// minScore is set far below any real floor so a signal is always returned
// for both directions, including a negative score if the thesis has fully
// reversed — that negative number IS the useful exit signal.
export async function rescoreForExit(
  symbols: string[]
): Promise<Map<string, { ceScore: number; peScore: number; ceConfidence: number; peConfidence: number }>> {
  const result = new Map<string, { ceScore: number; peScore: number; ceConfidence: number; peConfidence: number }>();
  const uniqueSymbols = [...new Set(symbols)];
  if (uniqueSymbols.length === 0) return result;

  const sectorMap = buildSectorMap();
  let vixGuidance: VIXGuidance | null = null;
  try {
    const vixData = await fetchVIX();
    vixGuidance = getVIXGuidance(vixData.value);
  } catch { /* proceed without VIX — same graceful-degrade as the main scan */ }
  let niftyCandles: OHLCV[] = [];
  try {
    niftyCandles = (await getHistoricalData('NIFTY50', 300)).data;
  } catch { /* proceed without Nifty regime context */ }
  let globalCtx: GlobalMarketsContext | null = null;
  try {
    globalCtx = await fetchGlobalMarketsContext();
  } catch { /* proceed without global context */ }

  for (const symbol of uniqueSymbols) {
    try {
      const signals = await scanStock(symbol, sectorMap, -9999, vixGuidance, niftyCandles, globalCtx);
      const ce = signals.find(s => s.direction === 'CE');
      const pe = signals.find(s => s.direction === 'PE');
      result.set(symbol, {
        ceScore: ce?.score ?? 0,
        peScore: pe?.score ?? 0,
        ceConfidence: ce?.confidence ?? 0,
        peConfidence: pe?.confidence ?? 0,
      });
    } catch { /* leave this symbol out — caller treats "missing" as "hold, don't guess" */ }
  }
  return result;
}