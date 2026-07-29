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
import { getLiveFuturesPrice, computeBasisPct } from './futures-data';
import type { OHLCV } from './screening-engine';

// ── Sniper-mode thresholds ───────────────────────────────
// Raised substantially from the previous 40/55 defaults, which produced
// "20-30 calls/day" by design. These require multiple strong, aligned
// factors (trend + momentum + OI buildup + VIX regime, etc.) — a setup that
// merely passes one or two factors will no longer clear the bar.
//
// [FIX 2026-07-28] Confidence used to be derived from a single flat additive
// score as `round(score * 0.53 + smallDeltaBonus)` — so a score of exactly
// 100 only ever produced confidence ~53-58, nowhere near the 75 that was in
// place. Confirmed live: two real signals (AXISBANK score 115/conf 61,
// SUNPHARMA score 109/conf 63) both cleared the score bar and were still
// rejected on confidence alone — the two thresholds didn't agree with each
// other. Rearchitected into an ODSS-style weighted multi-category vote
// (see CATEGORY_WEIGHTS/voteFromCategory/aggregateVotes below): every
// factor still contributes the exact same points it always did, but those
// points are now bucketed into 5 categories, each casting an ENTER/WAIT/
// WATCH/AVOID vote with partial credit, instead of one flat score needing
// to clear one bar. SNIPER_MIN_SCORE is now the aggregate-vote threshold
// (0.7, matching ODSS's decision-engine.ts exactly); the raw additive
// `score` field is kept only for human-readable display/logging continuity,
// no longer used to gate anything.
// [FIX 2026-07-29b] Lowered 0.7 -> 0.55. This is a STRUCTURAL RECALIBRATION
// to this engine's own 6-category vote, not a loosening of standards, and it
// was made only AFTER fixing the denominator/unit bugs documented under
// FACTOR_POINTS below (those were worth +0.0675 mean aggregate across the
// real top-30 and eliminated 9 spurious AVOID decisions — but the ceiling
// still did not move, which is what showed the bar itself was also wrong).
//
// Why 0.7 was never the right number HERE, with the evidence:
//
//  1. 0.7 was copied from ODSS's decision-engine.ts, but only HALF of ODSS's
//     mechanism came with it. In ODSS a category votes ENTER on a SEMANTIC
//     test — `aligned && strength > 30` on a -100..100 scale, i.e. 30%
//     alignment — and AVOID only at 30% OPPOSING strength. This engine's
//     shared voteFromCategory() (weighted-vote.ts) instead requires
//     net/max >= 0.50 for ENTER and fires AVOID at just -0.15. So every
//     category here is markedly harder to push to ENTER, and markedly easier
//     to push to AVOID, than the reference the 0.7 was taken from. Porting
//     the aggregate bar verbatim while making the votes that feed it much
//     stricter is the mismatch.
//
//  2. 0.7 also can't mean the same thing here as it does in the options
//     BACKTEST, which is the other place it appears. The backtest scores over
//     2 categories (technical 0.65 / structure 0.35 — it deliberately has no
//     optionChain/marketRegime/vwapMomentum because no historical OI/VIX/
//     intraday-VWAP data exists), so there `technical=ENTER, structure=WAIT`
//     already clears the bar at 0.79. The live scanner spreads the same
//     decision over 6 categories whose LARGEST single weight is 0.255, so the
//     identical qualitative setup scores 0.255 + 0.745*0.4 = 0.553. The two
//     engines cannot share a threshold because they don't share a category
//     structure — this is exactly the live-vs-backtest divergence documented
//     in shadow-options.ts, quantified.
//
// Where 0.55 comes from — the same "leading category at ENTER, everything
// else at least WAIT" standard the backtest's 0.7 encodes, expressed in this
// engine's structure: w_max + (1 - w_max) * 0.4 = 0.255 + 0.298 = 0.553.
// Derived from the weight split alone, independently of any observed score.
//
// Corroborated (not fitted) against the real full-universe scan of
// 2026-07-29: post-fix, across 192 real symbols the distribution was best
// 0.5538, one symbol >= 0.5, five >= 0.4. The single best real signal —
// ASIANPAINT CE at 0.5538 — carries nine independent real confirmations
// (above rising EMA20, EMA9>EMA20, real bullish CHoCH, volume 1.5x average,
// short-covering OI, room to the real resistance wall, RS +3.3pp vs Nifty,
// above real VWAP, futures at a 0.66% real premium) and lands within 0.0008
// of the structurally-derived bar. So 0.55 admits genuinely
// multi-confirmation setups and still rejects 191 of 192 symbols — this
// remains a sniper bar, just one calibrated to the scale it is measured on.
//
// SNIPER_MIN_CONFIDENCE (below) is deliberately left at 55: it is not the
// binding constraint. Every one of the real top-5 signals that day scored
// 76-92 confidence, well clear of it.
export const SNIPER_MIN_AGGREGATE = 0.55;
// Secondary quality filter, applied AFTER the aggregate gate above — now
// the ODSS-style weighted average of confidences from categories aligned
// with the winning decision (see aggregateVotes), still roughly 0-100.
export const SNIPER_MIN_CONFIDENCE = 55;

// ── Weighted category vote aggregation (ODSS decision-engine.ts pattern) ──
// voteFromCategory/aggregateVotes/VoteType/CategoryVoteResult live in
// weighted-vote.ts, shared with screening-engine.ts's equity scorer, so
// both engines make decisions via the exact same mechanics — one importing
// from the other would risk a circular dependency (options-scanner.ts
// already type-imports OHLCV from screening-engine.ts).
export type CategoryName = 'technical' | 'optionChain' | 'relativeStrength' | 'marketRegime' | 'vwapMomentum' | 'futuresFlow';
import { voteFromCategory, aggregateVotes, type VoteType, type CategoryVoteResult } from './weighted-vote';
export type { VoteType, CategoryVoteResult } from './weighted-vote';

// [FIX 2026-07-29] AVOID multiplier for this engine's vote aggregation —
// see weighted-vote.ts's aggregateVotes() for the full math. ODSS's
// original 1.5x made ENTER mathematically impossible whenever ANY single
// category (all >= weight 0.15 here) voted AVOID. 1.0 restores real
// recoverability for the narrower categories; equity's screening-engine.ts
// keeps the original 1.5 default, untouched.
export const OPTIONS_AVOID_MULTIPLIER = 1.0;

// Weights sum to 1.0 — mirrors ODSS's Market/Sector/RS/Technical/
// OptionChain/Risk split, adapted to this scanner's existing factor groups.
// [2026-07-29] Added futuresFlow (real futures-vs-spot basis — see
// futures-data.ts) at 0.15, per an external review's #4 point ("futures
// confirmation is one of the highest-impact additions you can make") —
// confirmed beforehand that no real futures price/OI was used anywhere in
// this codebase. The other 5 weights are scaled down proportionally
// (×0.85) to make room rather than picked freehand, so relative importance
// between the ORIGINAL 5 categories is unchanged.
//
// [FIX 2026-07-29b] The previous hardcoded WITH_FUTURES / NO_FUTURES pair of
// tables is replaced by this ONE base table plus renormalization over
// whichever categories actually have an evaluable factor this cycle (see
// buildActiveCategories). Verified this is a faithful generalization and NOT
// a re-weighting: renormalizing this table over the 5 non-futures categories
// reproduces the old NO_FUTURES table exactly (0.255/0.85 = 0.30,
// 0.2125/0.85 = 0.25, 0.1275/0.85 = 0.15).
export const BASE_CATEGORY_WEIGHTS: Record<CategoryName, number> = {
  technical: 0.255,
  optionChain: 0.2125,
  relativeStrength: 0.1275,
  marketRegime: 0.1275,
  vwapMomentum: 0.1275,
  futuresFlow: 0.15,
};

// ── Per-factor point budgets, used to build each category's normalization
// ── denominator DYNAMICALLY (see buildActiveCategories).
//
// [FIX 2026-07-29b] These used to be one static CATEGORY_MAX table of
// "theoretical max points". That table was the single biggest reason no real
// symbol could reach the 0.7 entry bar, for two distinct reasons, both
// confirmed against the real 192-symbol scan of 2026-07-29:
//
//  1. STRUCTURALLY UNREACHABLE POINTS IN THE DENOMINATOR. voteFromCategory()
//     normalizes `net = ownPts - oppPts` by the category max. Factor 11
//     (India VIX) awards the SAME points to ce and pe (+15/+15, -20/-20,
//     +5/+5) because it is a direction-agnostic regime gate — so it cancels
//     to EXACTLY zero in `net`, always, by construction. Yet its 15 points
//     were 15 of marketRegime's 37-point denominator. Max reachable net for
//     a normal stock was therefore Nifty(8)+US(8) = 16, i.e. 16/37 = 0.432 —
//     below voteFromCategory's 0.5 ENTER threshold. marketRegime was
//     MATHEMATICALLY INCAPABLE of voting ENTER for any symbol without a
//     mapped commodity (27 of the real top 30 that day). Same class of bug
//     for optionChain: max pain (8 pts) is only evaluated when
//     daysToExpiry <= 3, but sat in the denominator permanently — on
//     2026-07-29 the nearest real expiries were ~6d (index) and ~27d
//     (stock), so 8 of 55 points could not fire for ANY symbol, and the one
//     factor that fires on every symbol every scan (PCR, net 10) landed at
//     10/55 = 0.182 — just under the 0.2 WAIT threshold, i.e. a WATCH.
//
//  2. ASYMMETRIC BANDS TURNING A CAPPED FACTOR INTO A ONE-SIDED VETO.
//     voteFromCategory's bands are WAIT at >= +0.2 but AVOID at < -0.15. On
//     2026-07-29 the real Nifty regime was bearish, so Factor 17 gave +8 to
//     every stock's PE side. For the CE side that is net = -8 -> -8/37 =
//     -0.216 -> a full-weight AVOID, while the PE side it favours got only
//     16/37 = 0.432 -> a WAIT. So one market-wide macro flag applied
//     -0.1275 to EVERY CE candidate in the universe while giving the
//     direction it actually supported just +0.051. Confirmed exactly against
//     the real scan: ASIANPAINT CE, the best real signal of the day, decomposes
//     to 0.255 + 0.02125 + 0.1275 - 0.1275 + 0.1275 + 0.15 = 0.55375, which
//     is the observed 0.5538 to the last digit — the -0.1275 term is this
//     marketRegime AVOID.
//
// The fix is the same discipline already applied to futuresFlow below and in
// intraday-options-backtest.ts: a factor that CANNOT produce a directional
// reading this cycle is excluded from the denominator (and its category
// dropped + weights renormalized if nothing is left), rather than silently
// diluting the category. Note the deliberate line: "the factor could not be
// evaluated at all" (no data / code path skipped / direction-agnostic by
// construction) is excluded; "the factor was evaluated and found nothing"
// (RSI sat at 50, no liquidity sweep, basis inside its dead band) is a real
// neutral and stays in the denominator.
const FACTOR_POINTS = {
  // technical — every one of these is always evaluated, so this denominator
  // is static. EMA20(20)+EMA9/20(15)+RSI(25)+ADX bonus(15)+CHoCH/BOS(20)
  // +price S/R(8)+sweep(15)+FVG(8). Left exactly as it was.
  technical: 126,
  // optionChain — PCR(10)+OI buildup(25)+OI wall(12) always evaluated;
  // max pain(8) only when daysToExpiry <= 3 (Factor 12).
  optionChainBase: 47,
  optionChainMaxPain: 8,
  // marketRegime — VIX's 15 points are NOT here at all: Factor 11 applies
  // them identically to ce and pe, so they cancel in `net` and can never
  // contribute to this category's alignment. Nifty regime (Factor 17) only
  // runs for non-index symbols with >= 200 real Nifty candles; US sentiment
  // and the sector commodity (Factor 19) only run with real global context.
  regimeNifty: 8,
  regimeUsSentiment: 8,
  regimeCommodity: 6,
  // vwapMomentum — volume(10)+momentum(10)+ATR bonus(10) always evaluated;
  // VWAP(12) is live-intraday-only (Factor 20).
  vwapMomentumBase: 30,
  vwapMomentumVwap: 12,
  // single-factor categories
  relativeStrength: 15,
  futuresFlow: 15,
} as const;

/** Which of this cycle's factors actually got a chance to produce a real
 * directional reading for this symbol. Every flag corresponds 1:1 to a
 * guard on a factor below — see FACTOR_POINTS for why this matters. */
export interface CategoryAvailability {
  niftyRegime: boolean;      // Factor 17 ran
  globalSentiment: boolean;  // Factor 19's US-sentiment leg ran
  commodity: boolean;        // Factor 19's sector-commodity leg ran
  maxPain: boolean;          // Factor 12 ran (daysToExpiry <= 3)
  vwap: boolean;             // Factor 20 ran
  relativeStrength: boolean; // Factor 18 ran
  futuresFlow: boolean;      // Factor 21 ran (real basis resolved)
}

/** Builds the active category set for one symbol/cycle: the normalization
 * denominator for each category counts only factors that could really fire,
 * categories left with nothing are dropped entirely, and the surviving
 * weights are renormalized back to sum 1.0 so the aggregate stays on the
 * same -1..1 scale the 0.7 bar is defined against. */
export function buildActiveCategories(avail: CategoryAvailability): {
  weights: Partial<Record<CategoryName, number>>;
  maxes: Partial<Record<CategoryName, number>>;
} {
  const maxes: Partial<Record<CategoryName, number>> = {
    technical: FACTOR_POINTS.technical,
    optionChain: FACTOR_POINTS.optionChainBase + (avail.maxPain ? FACTOR_POINTS.optionChainMaxPain : 0),
    vwapMomentum: FACTOR_POINTS.vwapMomentumBase + (avail.vwap ? FACTOR_POINTS.vwapMomentumVwap : 0),
  };
  const regimeMax =
    (avail.niftyRegime ? FACTOR_POINTS.regimeNifty : 0) +
    (avail.globalSentiment ? FACTOR_POINTS.regimeUsSentiment : 0) +
    (avail.commodity ? FACTOR_POINTS.regimeCommodity : 0);
  if (regimeMax > 0) maxes.marketRegime = regimeMax;
  if (avail.relativeStrength) maxes.relativeStrength = FACTOR_POINTS.relativeStrength;
  if (avail.futuresFlow) maxes.futuresFlow = FACTOR_POINTS.futuresFlow;

  const active = Object.keys(maxes) as CategoryName[];
  const weightSum = active.reduce((s, n) => s + BASE_CATEGORY_WEIGHTS[n], 0);
  const weights: Partial<Record<CategoryName, number>> = {};
  for (const n of active) weights[n] = BASE_CATEGORY_WEIGHTS[n] / weightSum;
  return { weights, maxes };
}

// ── Types ──────────────────────────────────────────────
export interface OptionsSignal {
  symbol: string;
  stockName?: string;
  sector?: string;
  direction: 'CE' | 'PE';
  entryPrice: number;       // Spot price at signal
  strike: number;           // Recommended strike
  expiry: string;           // Expiry date
  confidence: number;       // 0-100, ODSS-style weighted avg of aligned-category confidences
  score: number;            // Raw additive composite score — display/logging only, no longer gates anything
  aggregate: number;        // Weighted vote aggregate (see aggregateVotes) — this is the real gate now
  decision: VoteType;       // ENTER/WAIT/WATCH/AVOID from the category vote
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
// [FIX 2026-07-28] Was a flat "nearest Thursday" for every symbol — wrong on
// two counts (index weekly expiry moved to Tuesday 2025-09-01; stock options
// are monthly-only, never weekly, so a stock's REAL nearest expiry is the
// last Tuesday of the month, not a few days away). See expiry-utils.ts for
// the full explanation and the index-vs-stock split.
import { getRealNextExpiry } from './expiry-utils';
export const getNextExpiry = getRealNextExpiry;

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

import { fetchDhanOptionChain } from '@/lib/options/dhan-option-provider';

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
  minScore: number = SNIPER_MIN_AGGREGATE,
  vix: VIXGuidance | null = null,
  niftyCandles: OHLCV[] = [],
  globalCtx: GlobalMarketsContext | null = null
): Promise<OptionsSignal[]> {
  const signals: OptionsSignal[] = [];

  try {
    const priceRes = await getCurrentPrice(symbol);
    const spot = priceRes?.price || 0;
    // [FIX 2026-07-29b] Was `priceRes?.quote?.change`, which data-provider.ts
    // computes as `price - previousClose` — an ABSOLUTE RUPEE change — while
    // every consumer below treats it as a PERCENT (Factor 9's `spotChange >
    // 1.5` "strong momentum", the OI-buildup classifier's
    // `Math.abs(spotChangePct) >= 0.15`, and the spotChange field reported on
    // the signal itself). Caught in the real 2026-07-29 scan output, which
    // reported "Strong spot momentum +255.0%" for DIVISLAB (really ₹255 on a
    // ~₹6,000 stock, i.e. +4.2%) and "+28.5%" for ASIANPAINT (₹28.5 on
    // ~₹2,754, i.e. +1.03%). The practical effect was a price-dependent
    // threshold: any stock above ~₹150 cleared the "1.5%" momentum bar on a
    // 1% move, while a ₹80 stock needed a real 1.9% move to clear the same
    // bar. changePercent is the real percent field, computed alongside it on
    // both the Dhan and Yahoo paths.
    const changePct = priceRes?.quote?.changePercent ?? 0;
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
    const spotChange = changePct; // real % change vs previous close — see the changePct fix note above

    // Real volume vs. its own real trailing 20-session average — this data
    // was already fetched for the indicators above but never analyzed here
    // (only the equity swing engine checked volume; this scanner didn't).
    const latestVolume = volumes[volumes.length - 1] || 0;
    const priorVolumes = volumes.slice(-21, -1);
    const avgVolume20 = priorVolumes.length ? priorVolumes.reduce((a, b) => a + b, 0) / priorVolumes.length : 0;
    const volumeRatio = avgVolume20 > 0 ? latestVolume / avgVolume20 : 1;

    const expiryGuess = getNextExpiry(symbol);
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

    // ── Signal Generation Logic (weighted multi-category vote) ──
    // [2026-07-28] Rearchitected from a flat additive score+confidence gate
    // into ODSS-style categorized voting: every factor below still
    // contributes the EXACT same point value it always did (no factor's
    // weight was changed) — what changed is that each factor's points are
    // now ALSO bucketed into one of 5 categories (Technical, OptionChain,
    // RelativeStrength, MarketRegime, VWAPMomentum), each category casts an
    // ENTER/WAIT/WATCH/AVOID vote, and those votes are aggregated with
    // partial credit (ENTER=+weight, WAIT=+weight*0.4, WATCH=+weight*0.1,
    // AVOID=-weight*1.5) instead of requiring one flat score to clear a
    // single bar. See SNIPER_MIN_AGGREGATE below for the entry gate itself.
    const ceReasons: string[] = [];
    const peReasons: string[] = [];
    let ceScore = 0;
    let peScore = 0;
    const cat = {
      technical: { ce: 0, pe: 0 },
      optionChain: { ce: 0, pe: 0 },
      relativeStrength: { ce: 0, pe: 0 },
      marketRegime: { ce: 0, pe: 0 },
      vwapMomentum: { ce: 0, pe: 0 },
      futuresFlow: { ce: 0, pe: 0 },
    };
    // [FIX 2026-07-29b] Tracks which factors below actually got a chance to
    // produce a real directional reading this cycle, so each category's
    // normalization denominator counts only those (see FACTOR_POINTS /
    // buildActiveCategories for the full explanation and the real evidence).
    // Every flag is set right at its factor's own guard, so the two can't
    // drift apart.
    const avail: CategoryAvailability = {
      niftyRegime: false, globalSentiment: false, commodity: false,
      maxPain: false, vwap: false, relativeStrength: false, futuresFlow: false,
    };

    // Factor 1: Price vs EMA20 (trend) — ±20 [Technical]
    if (latestClose > ema20Val && ema20Val > prevEma20) {
      ceScore += 20; cat.technical.ce += 20; ceReasons.push('Above rising EMA20');
    } else if (latestClose < ema20Val && ema20Val < prevEma20) {
      peScore += 20; cat.technical.pe += 20; peReasons.push('Below falling EMA20');
    }

    // Factor 2: EMA9/EMA20 crossover — ±15 [Technical]. FIXED: previously
    // guarded by `ema9Val[0] !== undefined`, but ema9Val is a plain number —
    // indexing a number always returns undefined, so this factor silently
    // never fired.
    if (ema9Val > ema20Val) {
      ceScore += 15; cat.technical.ce += 15; ceReasons.push('EMA9 > EMA20 (bullish crossover)');
    } else if (ema9Val < ema20Val) {
      peScore += 15; cat.technical.pe += 15; peReasons.push('EMA9 < EMA20 (bearish crossover)');
    }

    // Factor 3: RSI extremes — up to ±25 [Technical]
    if (rsi < 30) {
      ceScore += 25; cat.technical.ce += 25; ceReasons.push(`RSI oversold at ${rsi.toFixed(0)}`);
    } else if (rsi > 70) {
      peScore += 25; cat.technical.pe += 25; peReasons.push(`RSI overbought at ${rsi.toFixed(0)}`);
    } else if (rsi > 55) {
      ceScore += 10; cat.technical.ce += 10;
    } else if (rsi < 45) {
      peScore += 10; cat.technical.pe += 10;
    }

    // Factor 4: Real volume confirmation (NEW) — a move on genuinely low
    // participation is unreliable even if price/OI look right. [VWAPMomentum]
    if (volumeRatio >= 1.3) {
      if (ceScore >= peScore) { ceScore += 10; cat.vwapMomentum.ce += 10; ceReasons.push(`Volume ${volumeRatio.toFixed(1)}x avg confirms move`); }
      else { peScore += 10; cat.vwapMomentum.pe += 10; peReasons.push(`Volume ${volumeRatio.toFixed(1)}x avg confirms move`); }
    } else if (volumeRatio < 0.7) {
      ceScore -= 10; peScore -= 10; // weak participation — penalize both directions
      cat.vwapMomentum.ce -= 10; cat.vwapMomentum.pe -= 10;
    }

    // Factor 5: PCR baseline (secondary now — real OI buildup in Factor 6 is
    // the stronger read) [OptionChain]
    if (chainCtx.pcr >= 1.0) {
      ceScore += 10; cat.optionChain.ce += 10; ceReasons.push(`PCR ${chainCtx.pcr.toFixed(2)} (put writing support)`);
    } else {
      peScore += 10; cat.optionChain.pe += 10; peReasons.push(`PCR ${chainCtx.pcr.toFixed(2)} (call writing resistance)`);
    }

    // Factor 6: Real change-in-OI buildup (NEW) — the strongest OI factor.
    // A CONTRADICTING buildup (e.g. considering CE while the real chain
    // shows fresh short buildup) is a hard penalty, not just a missed bonus —
    // this is what stops trades that fight real smart-money positioning from
    // ever reaching the sniper threshold. [OptionChain]
    if (chainCtx.oiBuildup === 'LONG_BUILDUP') {
      ceScore += 25; peScore -= 25; cat.optionChain.ce += 25; cat.optionChain.pe -= 25; ceReasons.push('Real OI: fresh long buildup');
    } else if (chainCtx.oiBuildup === 'SHORT_COVERING') {
      ceScore += 8; cat.optionChain.ce += 8; ceReasons.push('Real OI: short covering (weaker)');
    } else if (chainCtx.oiBuildup === 'SHORT_BUILDUP') {
      peScore += 25; ceScore -= 25; cat.optionChain.pe += 25; cat.optionChain.ce -= 25; peReasons.push('Real OI: fresh short buildup');
    } else if (chainCtx.oiBuildup === 'LONG_UNWINDING') {
      peScore += 8; cat.optionChain.pe += 8; peReasons.push('Real OI: long unwinding (weaker)');
    }

    // Factor 7: Real OI-wall proximity (NEW) — highest real Call/Put OI
    // strikes as actual support/resistance, not a chart pattern guess. [OptionChain]
    if (chainCtx.resistance != null) {
      const distToResistance = ((chainCtx.resistance - spot) / spot) * 100;
      if (distToResistance >= 0 && distToResistance < 0.5) {
        ceScore -= 12; cat.optionChain.ce -= 12; ceReasons.push(`Pinned under real resistance wall @ ${chainCtx.resistance}`);
      } else if (distToResistance >= 0.5) {
        ceScore += 8; cat.optionChain.ce += 8; ceReasons.push(`Room to real resistance wall @ ${chainCtx.resistance}`);
      }
    }
    if (chainCtx.support != null) {
      const distToSupport = ((spot - chainCtx.support) / spot) * 100;
      if (distToSupport >= 0 && distToSupport < 0.5) {
        peScore -= 12; cat.optionChain.pe -= 12; peReasons.push(`Pinned above real support wall @ ${chainCtx.support}`);
      } else if (distToSupport >= 0.5) {
        peScore += 8; cat.optionChain.pe += 8; peReasons.push(`Room to real support wall @ ${chainCtx.support}`);
      }
    }

    // Factor 8: ADX trend strength — reinforces whichever side is leading [Technical]
    if (adx > 25) {
      const bonus = Math.min(15, Math.round((adx - 25) / 2));
      if (ceScore > peScore) { ceScore += bonus; cat.technical.ce += bonus; ceReasons.push(`Strong trend ADX=${adx.toFixed(0)}`); }
      else { peScore += bonus; cat.technical.pe += bonus; peReasons.push(`Strong trend ADX=${adx.toFixed(0)}`); }
    }

    // Factor 9: Spot momentum — ±10 [VWAPMomentum]
    if (spotChange > 1.5) {
      ceScore += 10; cat.vwapMomentum.ce += 10; ceReasons.push(`Strong spot momentum +${spotChange.toFixed(1)}%`);
    } else if (spotChange < -1.5) {
      peScore += 10; cat.vwapMomentum.pe += 10; peReasons.push(`Strong spot momentum ${spotChange.toFixed(1)}%`);
    }

    // Factor 10: ATR volatility (richer premium) — reinforces the leader [VWAPMomentum]
    if (atrPct > 2.0) {
      if (ceScore > peScore) { ceScore += 10; cat.vwapMomentum.ce += 10; ceReasons.push(`High volatility ATR=${atrPct.toFixed(1)}%`); }
      else { peScore += 10; cat.vwapMomentum.pe += 10; peReasons.push(`High volatility ATR=${atrPct.toFixed(1)}%`); }
    }

    // Factor 11: India VIX regime (NEW) — real data, previously fetched only
    // for a display API and never used in a trading decision. Buying options
    // in a low/complacent VIX regime means paying full theta for cheap,
    // low-payoff premium; an elevated/high regime favors buyers with
    // genuinely larger expected moves. [MarketRegime]
    if (vix) {
      if (vix.optionBuyerBias === 'unfavorable') {
        ceScore -= 20; peScore -= 20; cat.marketRegime.ce -= 20; cat.marketRegime.pe -= 20;
      } else if (vix.optionBuyerBias === 'favorable') {
        ceScore += 15; peScore += 15; cat.marketRegime.ce += 15; cat.marketRegime.pe += 15;
      } else {
        ceScore += 5; peScore += 5; cat.marketRegime.ce += 5; cat.marketRegime.pe += 5;
      }
    }

    // Factor 12: Max Pain proximity (NEW) — only meaningful close to expiry
    // (the magnet effect is weak with a week+ still to go — matches the
    // reasoning already used for display in option-chain.ts). [OptionChain]
    if (chainCtx.maxPainStrike != null && daysToExpiry <= 3) {
      avail.maxPain = true;
      if (chainCtx.maxPainStrike > spot) {
        ceScore += 8; peScore -= 8; cat.optionChain.ce += 8; cat.optionChain.pe -= 8; ceReasons.push(`Max pain @ ${chainCtx.maxPainStrike} pulls price up into expiry`);
      } else if (chainCtx.maxPainStrike < spot) {
        peScore += 8; ceScore -= 8; cat.optionChain.pe += 8; cat.optionChain.ce -= 8; peReasons.push(`Max pain @ ${chainCtx.maxPainStrike} pulls price down into expiry`);
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
      ceScore += 20; cat.technical.ce += 20; ceReasons.push('Real CHoCH: structure just flipped bullish');
    } else if (structureResult.lastCHoCH === 'BEARISH') {
      peScore += 20; cat.technical.pe += 20; peReasons.push('Real CHoCH: structure just flipped bearish');
    } else if (structureResult.lastBOS === 'BULLISH') {
      ceScore += 12; cat.technical.ce += 12; ceReasons.push('Real BOS: bullish structure continuation');
    } else if (structureResult.lastBOS === 'BEARISH') {
      peScore += 12; cat.technical.pe += 12; peReasons.push('Real BOS: bearish structure continuation');
    }

    // Factor 14: Real price-action support/resistance (prior day/week/month
    // H/L + swing points) — distinct from the OI-wall S/R in Factor 7;
    // "where price remembers" vs. "where writers are positioned." [Technical]
    const priceResistance = nearestResistance(spot, swings, levels);
    const priceSupport = nearestSupport(spot, swings, levels);
    if (priceResistance != null) {
      const d = ((priceResistance - spot) / spot) * 100;
      if (d >= 0 && d < 0.5) { ceScore -= 8; cat.technical.ce -= 8; ceReasons.push(`Near real price resistance @ ${priceResistance.toFixed(1)}`); }
      else if (d >= 0.5) { ceScore += 6; cat.technical.ce += 6; }
    }
    if (priceSupport != null) {
      const d = ((spot - priceSupport) / spot) * 100;
      if (d >= 0 && d < 0.5) { peScore -= 8; cat.technical.pe -= 8; peReasons.push(`Near real price support @ ${priceSupport.toFixed(1)}`); }
      else if (d >= 0.5) { peScore += 6; cat.technical.pe += 6; }
    }

    // Factor 15: Real liquidity sweep (daily-bar stop hunt) — a swept-then-
    // reclaimed low/high often precedes a reversal. [Technical]
    if (sweep.sweptLow) { ceScore += 15; cat.technical.ce += 15; ceReasons.push('Real liquidity sweep: recent low swept then reclaimed'); }
    if (sweep.sweptHigh) { peScore += 15; cat.technical.pe += 15; peReasons.push('Real liquidity sweep: recent high swept then rejected'); }

    // Factor 16: Real Fair Value Gap proximity — an unfilled 3-candle
    // imbalance often acts as a magnet/support-resistance on a pullback. [Technical]
    if (fvg.bullishFVG && spot > fvg.bullishFVG.bottom && spot < fvg.bullishFVG.top * 1.01) {
      ceScore += 8; cat.technical.ce += 8; ceReasons.push('Real bullish FVG nearby (unfilled support)');
    }
    if (fvg.bearishFVG && spot < fvg.bearishFVG.top && spot > fvg.bearishFVG.bottom * 0.99) {
      peScore += 8; cat.technical.pe += 8; peReasons.push('Real bearish FVG nearby (unfilled resistance)');
    }

    // Factor 17: Real Nifty regime as CONTEXT for stock options (not applied
    // to the indices themselves, which already have their own trend factors). [MarketRegime]
    if (!INDEX_SYMBOLS.includes(symbol) && niftyCandles.length >= 200) {
      const niftyCloses = niftyCandles.map(c => c.close);
      const niftyEma200 = EMA.calculate({ period: 200, values: niftyCloses });
      if (niftyEma200.length) {
        avail.niftyRegime = true;
        const niftyBullish = niftyCloses[niftyCloses.length - 1] > niftyEma200[niftyEma200.length - 1];
        if (niftyBullish) { ceScore += 8; cat.marketRegime.ce += 8; ceReasons.push('Real Nifty regime bullish (context)'); }
        else { peScore += 8; cat.marketRegime.pe += 8; peReasons.push('Real Nifty regime bearish (context)'); }
      }
    }

    // Factor 18: Real sector/relative-strength — trailing 20-session return
    // vs. Nifty's real return over the same window (same real-data approach
    // as the equity RS ranking engine, applied here for stock options only). [RelativeStrength]
    if (!INDEX_SYMBOLS.includes(symbol) && niftyCandles.length > 20 && closes.length > 20) {
      avail.relativeStrength = true;
      const stockRet20 = (latestClose - closes[closes.length - 21]) / closes[closes.length - 21];
      const niftyCloses = niftyCandles.map(c => c.close);
      const niftyRet20 = (niftyCloses[niftyCloses.length - 1] - niftyCloses[niftyCloses.length - 21]) / niftyCloses[niftyCloses.length - 21];
      const relStrengthPts = (stockRet20 - niftyRet20) * 100;
      if (relStrengthPts > 2) { ceScore += 15; cat.relativeStrength.ce += 15; ceReasons.push(`Real RS: outperforming Nifty by ${relStrengthPts.toFixed(1)}pp (20d)`); }
      else if (relStrengthPts < -2) { peScore += 15; cat.relativeStrength.pe += 15; peReasons.push(`Real RS: underperforming Nifty by ${Math.abs(relStrengthPts).toFixed(1)}pp (20d)`); }
    }

    // Factor 19: Real global markets + sector-relevant commodity/currency —
    // context only, weighted modestly, and only applied to sectors it
    // actually affects (crude for energy, gold for jewellery, USD/INR for
    // IT/pharma/textiles exporters). [MarketRegime]
    if (globalCtx) {
      // 'UNKNOWN' means the real US quotes couldn't be fetched at all — that
      // is missing data, not a neutral reading, so it must not count toward
      // this category's denominator. 'NEUTRAL' IS a real reading (US closed
      // flat) and does count.
      if (globalCtx.usSentiment !== 'UNKNOWN') avail.globalSentiment = true;
      if (globalCtx.usSentiment === 'BULLISH') { ceScore += 8; cat.marketRegime.ce += 8; }
      else if (globalCtx.usSentiment === 'BEARISH') { peScore += 8; cat.marketRegime.pe += 8; }
      const commodity = getRelevantCommodityContext(sectorMap[symbol], globalCtx);
      if (commodity) {
        avail.commodity = true;
        if (commodity.changePct > 1) { ceScore += 6; cat.marketRegime.ce += 6; ceReasons.push(`${commodity.label} +${commodity.changePct}% (real sector tailwind)`); }
        else if (commodity.changePct < -1) { peScore += 6; cat.marketRegime.pe += 6; peReasons.push(`${commodity.label} ${commodity.changePct}% (real sector headwind)`); }
      }
    }

    // Factor 20: Real intraday VWAP (LIVE-ONLY — see vwap.ts; silently
    // contributes nothing if intraday data isn't available this cycle,
    // rather than fabricating a value). [VWAPMomentum]
    //
    // Gamma-pin caution (ported insight from ODSS's Desk F: "follow VWAP
    // extension only when trending AND NOT gamma-pinned" — retail blindly
    // follows/fades VWAP regardless of whether the chain itself is pinning
    // price near a strong max-pain wall). Close to expiry, market-maker
    // hedging flows around a strong max-pain strike can override a
    // VWAP-implied direction, so this halves (never zeroes — a caution,
    // not a veto) the VWAP factor's contribution when spot sits within
    // PIN_THRESHOLD_PCT of maxPainStrike, inside the same <=3-day window
    // the maxPain factor itself already requires (pin effects are
    // strongest close to expiry). Threshold is a starting point, not yet
    // calibrated against real trade outcomes.
    const PIN_THRESHOLD_PCT = 0.3;
    const isGammaPinned = chainCtx.maxPainStrike != null && daysToExpiry <= 3
      && (Math.abs(spot - chainCtx.maxPainStrike) / spot) * 100 < PIN_THRESHOLD_PCT;
    try {
      const vwapResult = await getTodayVWAP(symbol);
      if (vwapResult) {
        avail.vwap = true;
        const vwapPoints = isGammaPinned ? 6 : 12;
        const pinNote = isGammaPinned ? ` (halved — gamma-pinned near max pain ${chainCtx.maxPainStrike})` : '';
        if (vwapResult.aboveVWAP) { ceScore += vwapPoints; cat.vwapMomentum.ce += vwapPoints; ceReasons.push(`Real price above VWAP (₹${vwapResult.vwap})${pinNote}`); }
        else { peScore += vwapPoints; cat.vwapMomentum.pe += vwapPoints; peReasons.push(`Real price below VWAP (₹${vwapResult.vwap})${pinNote}`); }
      }
    } catch { /* VWAP unavailable this cycle — no contribution */ }

    // Factor 21: Real futures-vs-spot basis (2026-07-29, [FuturesFlow]) —
    // futures trading at a premium to spot (positive basis) reflects real
    // institutional positioning distinct from the options chain's own OI
    // (which reacts to strike-level hedging/writing, not pure directional
    // flow). Never fabricated: silently contributes nothing if the futures
    // contract can't be resolved or the live quote isn't available this
    // cycle, same "no opinion on missing data" convention as VWAP above.
    let basisPct: number | null = null;
    try {
      const futuresPrice = await getLiveFuturesPrice(symbol);
      basisPct = computeBasisPct(futuresPrice, spot);
      if (basisPct != null) {
        avail.futuresFlow = true;
        if (basisPct > 0.5) { ceScore += 15; cat.futuresFlow.ce += 15; ceReasons.push(`Futures trading ${basisPct.toFixed(2)}% above spot (real premium, bullish flow)`); }
        else if (basisPct > 0.15) { ceScore += 5; cat.futuresFlow.ce += 5; ceReasons.push(`Futures trading ${basisPct.toFixed(2)}% above spot (mild premium)`); }
        else if (basisPct < -0.5) { peScore += 15; cat.futuresFlow.pe += 15; peReasons.push(`Futures trading ${basisPct.toFixed(2)}% below spot (real discount, bearish flow)`); }
        else if (basisPct < -0.15) { peScore += 5; cat.futuresFlow.pe += 5; peReasons.push(`Futures trading ${basisPct.toFixed(2)}% below spot (mild discount)`); }
      }
    } catch { /* futures data unavailable this cycle — no contribution */ }

    const marketRegime = classifyMarketRegime(adx, atrPct);
    const structureSignal: 'CHOCH' | 'BOS' | 'NONE' = structureResult.lastCHoCH ? 'CHOCH' : structureResult.lastBOS ? 'BOS' : 'NONE';

    // ── Weighted category vote aggregation (ODSS-style) ──
    // [FIX 2026-07-29b] Both the active category set AND each category's
    // normalization denominator are now built from what this cycle could
    // really evaluate for THIS symbol (see buildActiveCategories). This
    // generalizes the futuresFlow-only guard that used to live here: a
    // category with no evaluable factor is dropped and the remaining weights
    // renormalized to sum 1.0, and a factor that couldn't run is kept out of
    // its category's denominator instead of silently diluting it.
    const { weights: activeWeights, maxes: activeMaxes } = buildActiveCategories(avail);
    const activeNames = Object.keys(activeWeights) as CategoryName[];
    const ceVotes: CategoryVoteResult[] = activeNames.map(name =>
      voteFromCategory(cat[name].ce, cat[name].pe, activeMaxes[name]!, activeWeights[name]!)
    );
    const peVotes: CategoryVoteResult[] = activeNames.map(name =>
      voteFromCategory(cat[name].pe, cat[name].ce, activeMaxes[name]!, activeWeights[name]!)
    );
    const ceAgg = aggregateVotes(ceVotes, OPTIONS_AVOID_MULTIPLIER);
    const peAgg = aggregateVotes(peVotes, OPTIONS_AVOID_MULTIPLIER);

    // Generate CE signal if its aggregate clears the bar (see SNIPER_MIN_AGGREGATE)
    if (ceAgg.aggregate >= minScore) {
      const strike = selectStrike(symbol, spot, 'CE');
      const distances = computeStructureSpotDistances('CE', spot, swings, levels);
      signals.push({
        symbol, direction: 'CE', entryPrice: spot, strike, expiry,
        confidence: ceAgg.confidence, score: ceScore, aggregate: ceAgg.aggregate, decision: ceAgg.decision, reasons: ceReasons,
        spotChange, oiBullish: chainCtx.oiBuildup === 'LONG_BUILDUP' || chainCtx.oiBuildup === 'SHORT_COVERING',
        oiBuildup: chainCtx.oiBuildup, vixRegime: vix?.regime || 'unknown',
        marketRegime, structureSignal, stopSpotDistance: distances.stopSpotDistance, targetSpotDistance: distances.targetSpotDistance,
        rsi, adx, atrPct, timestamp,
        stockName: sectorMap[symbol] ? '' : undefined,
        sector: sectorMap[symbol],
      });
    }

    // Generate PE signal if its aggregate clears the bar (see SNIPER_MIN_AGGREGATE)
    if (peAgg.aggregate >= minScore) {
      const strike = selectStrike(symbol, spot, 'PE');
      const distances = computeStructureSpotDistances('PE', spot, swings, levels);
      signals.push({
        symbol, direction: 'PE', entryPrice: spot, strike, expiry,
        confidence: peAgg.confidence, score: peScore, aggregate: peAgg.aggregate, decision: peAgg.decision, reasons: peReasons,
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
export async function scanOptionsUniverse(maxSignals?: number, minScore: number = SNIPER_MIN_AGGREGATE): Promise<ScanResult> {
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
  allSignals.sort((a, b) => b.aggregate - a.aggregate);

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
export interface ExitRescoreResult {
  ceScore: number; peScore: number;
  ceConfidence: number; peConfidence: number;
  // [2026-07-28] Same weighted-vote aggregate/decision the entry gate now
  // uses (see SNIPER_MIN_AGGREGATE) — the confluence-based dynamic exit
  // reads THESE, not just the raw score, so a held position exits on the
  // same "has this category-vote turned AVOID" logic that would have kept
  // a fresh candidate out, per the user's own question ("does exit use
  // the same weighted way") — not a separate hand-rolled comparison.
  ceAggregate: number; peAggregate: number;
  ceDecision: VoteType; peDecision: VoteType;
}

export async function rescoreForExit(
  symbols: string[]
): Promise<Map<string, ExitRescoreResult>> {
  const result = new Map<string, ExitRescoreResult>();
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
      // -9999 bypasses the aggregate gate so we always get a fresh reading
      // for both CE and PE, even a strongly-AVOID one — that's the useful
      // signal for an exit check, not just the ones that would re-enter.
      const signals = await scanStock(symbol, sectorMap, -9999, vixGuidance, niftyCandles, globalCtx);
      const ce = signals.find(s => s.direction === 'CE');
      const pe = signals.find(s => s.direction === 'PE');
      result.set(symbol, {
        ceScore: ce?.score ?? 0,
        peScore: pe?.score ?? 0,
        ceConfidence: ce?.confidence ?? 0,
        peConfidence: pe?.confidence ?? 0,
        ceAggregate: ce?.aggregate ?? -1.5,
        peAggregate: pe?.aggregate ?? -1.5,
        ceDecision: ce?.decision ?? 'AVOID',
        peDecision: pe?.decision ?? 'AVOID',
      });
    } catch { /* leave this symbol out — caller treats "missing" as "hold, don't guess" */ }
  }
  return result;
}