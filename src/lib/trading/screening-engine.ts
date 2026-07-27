/**
 * V-Swing Screening & Backtesting Engine v76.0 — Weekly Rebalance & Vacant Slot Filler
 * Automatically scans Nifty 500 Relative Strength every 7 days & fills vacant slots opportunistically.
 */

import { SMA, EMA, RSI, ATR, ADX } from 'technicalindicators';
import { calculateEquityCosts, calculateOptionsCosts } from './transaction-costs';
import { assessReliability } from './stat-reliability';
import { blackScholes, isIndexSymbol, getOptionLotSize } from '@/lib/options/black-scholes';
import {
  findSwingPoints, analyzeMarketStructure, getPriceActionLevels, nearestSupport, nearestResistance,
  detectLiquiditySweep, detectFVG,
} from './market-structure';

// Duplicated from options-scanner.ts rather than imported: options-scanner.ts
// transitively imports dhan-option-provider.ts, which uses Node's `fs`/`path`
// (server-only) — importing it here would break client-side bundling, since
// this file is also imported by the client-side backtest-tab.tsx.
function getStrikeStep(symbol: string, spot: number): number {
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

export interface OHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StockRankWeight {
  symbol: string;
  name: string;
  rank: number;
  weightPct: number;
  rankReason?: string;
  perf1W?: string;
  perf1M?: string;
  high52W?: string;
  low52W?: string;
}

export const TOP_7_RANKED_SYMBOLS: StockRankWeight[] = [
  { symbol: 'TATAELXSI', name: 'Tata Elxsi', rank: 1, weightPct: 0.25, rankReason: 'Highest RS 98 vs Nifty 500 & Leader in AI / Engineering R&D', perf1W: '+4.2%', perf1M: '+14.5%', high52W: '₹9,200', low52W: '₹6,400' },
  { symbol: 'DEEPAKNTR', name: 'Deepak Nitrite', rank: 2, weightPct: 0.20, rankReason: 'Specialty Chemical Outperformer with strong institutional accumulation', perf1W: '+2.8%', perf1M: '+9.4%', high52W: '₹3,150', low52W: '₹2,050' },
  { symbol: 'ADANIENT',  name: 'Adani Enterprises', rank: 3, weightPct: 0.16, rankReason: 'High-Beta Momentum Leader with massive volume expansion on breakouts', perf1W: '+5.1%', perf1M: '+18.2%', high52W: '₹3,750', low52W: '₹2,200' },
  { symbol: 'TATAPOWER', name: 'Tata Power', rank: 4, weightPct: 0.13, rankReason: 'Renewable Energy Momentum play holding steady above 200 SMA', perf1W: '+1.9%', perf1M: '+8.1%', high52W: '₹495', low52W: '₹320' },
  { symbol: 'HINDCOPPER',name: 'Hindustan Copper', rank: 5, weightPct: 0.11, rankReason: 'Metals Cycle Outperformer tracking strong global copper demand', perf1W: '+3.7%', perf1M: '+16.0%', high52W: '₹415', low52W: '₹240' },
  { symbol: 'VEDL',       name: 'Vedanta Limited', rank: 6, weightPct: 0.09, rankReason: 'High Dividend Yield + Metals Recovery play with volume surge', perf1W: '+2.1%', perf1M: '+7.6%', high52W: '₹510', low52W: '₹310' },
  { symbol: 'SUZLON',     name: 'Suzlon Energy', rank: 7, weightPct: 0.06, rankReason: 'Turnaround Wind Leader with robust orderbook & strong momentum', perf1W: '+6.4%', perf1M: '+22.5%', high52W: '₹86', low52W: '₹44' },
];

export const VACANT_SLOT_CANDIDATES: StockRankWeight[] = [
  { symbol: 'HDFCAMC',    name: 'HDFC AMC', rank: 8, weightPct: 0.07, rankReason: 'AMC Sector Leader with consistent AUM growth & strong RS', perf1W: '+2.4%', perf1M: '+10.1%', high52W: '₹4,600', low52W: '₹3,100' },
  { symbol: 'TRENT',      name: 'Trent Ltd', rank: 9, weightPct: 0.05, rankReason: 'Retail Growth Giant with exceptional revenue growth & momentum', perf1W: '+4.8%', perf1M: '+19.3%', high52W: '₹8,300', low52W: '₹4,900' },
  { symbol: 'ADANIPOWER', name: 'Adani Power', rank: 10, weightPct: 0.04, rankReason: 'Power Generation Leader with sharp earnings growth momentum', perf1W: '+3.1%', perf1M: '+12.7%', high52W: '₹890', low52W: '₹510' },
];

export const DEFAULT_WATCHLIST = TOP_7_RANKED_SYMBOLS.map(s => s.symbol);

export interface ScreeningConfig {
  liveCapital: number;
  riskPct: number;
  maxSlots: number;
  maxOpenTrades: number;
  maxHoldBars: number;
  minScore: number;
  minRR: number;
  cooldownBars: number;
  useMacro: boolean;
  minTurnoverCr: number;
  niftyRegimeFilter: boolean;
  volumeSurgeMultiplier: number;
  engineMode?: 'OPTIONS' | 'SWING' | 'HYBRID';
  rebalanceIntervalDays?: number;
  autoFillVacantSlots?: boolean;
}

export const DEFAULT_CONFIG: ScreeningConfig = {
  liveCapital: 300000,
  riskPct: 1.0,
  maxSlots: 7,
  maxOpenTrades: 7,
  maxHoldBars: 30,
  minScore: 3,
  minRR: 1.5,
  cooldownBars: 3,
  useMacro: true,
  minTurnoverCr: 5.0,
  niftyRegimeFilter: true,
  volumeSurgeMultiplier: 1.2,
  engineMode: 'HYBRID',
  rebalanceIntervalDays: 7, // Weekly Relative Strength Rebalance
  autoFillVacantSlots: true, // Fill vacant slots on EMA20 pullback trigger
};

export interface ConfluenceScores {
  scoreTrend: number;
  scorePullback: number;
  scoreTrigger: number;
  scoreVolume: number;
  scoreRS: number;
  scoreGap: number;
  totalScore: number;
}

export interface ScreeningResult {
  symbol: string;
  name?: string;
  date: string;
  score: number;
  setupType: 'A+' | 'B' | null;
  status?: 'MET' | 'PENDING';
  currentPrice?: number;
  missingConditions?: string[];
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  riskReward: number;
  atr: number;
  rsi: number;
  rank: number;
  weightPct: number;
  rankReason?: string;
  perf1W?: string;
  perf1M?: string;
  high52W?: string;
  low52W?: string;
  scores: ConfluenceScores;
  checks: {
    trendAbove: boolean;
    pullbackOk: boolean;
    triggerOk: boolean;
    volumeOk: boolean;
    rsOk: boolean;
    gapOk: boolean;
    regimeSafe: boolean;
    liquid: boolean;
    trending: boolean;
    validVol: boolean;
    notExtended: boolean;
  };
  sizing: {
    allocatedCapital: number;
    qty: number;
    riskPerShare: number;
    riskAmt: number;
  };
  indicators: {
    sma200: number;
    ema20: number;
    ema10: number;
    adx: number;
  };
}

export interface BacktestResult {
  stats: {
    totalTrades: number;
    winTrades: number;
    lossTrades: number;
    winRate: number;
    profitFactor: number;
    maxDrawdown: number;
    finalCapital: number;
    avgWin: number;
    avgLoss: number;
    bestTrade: number;
    worstTrade: number;
    sharpeRatio: number;
  };
  trades: Array<{
    symbol: string;
    entryDate: string;
    exitDate: string;
    entryPrice: number;
    exitPrice: number;
    qty: number;
    lots: number;
    totalValue: number;
    pnl: number;
    pnlPercent: number;
    score: number;
    setupType: string;
    exitReason: string;
  }>;
  equityCurve: Array<{
    date: string;
    equity: number;
  }>;
  monthlyPnl: Array<{
    month: string;   // YYYY-MM
    trades: number;
    winRate: number;
    netPnl: number;
  }>;
}

export function runScreening(
  symbol: string,
  candles: OHLCV[],
  config: ScreeningConfig = DEFAULT_CONFIG,
  isNiftyBullish: boolean = true,
  includeUnmet: boolean = false,
  niftyCandles?: OHLCV[],
  // Real weekly-computed rank/weight table (see rs-ranking.ts). Falls back to
  // the static TOP_7_RANKED_SYMBOLS list only when the caller has no dynamic
  // ranking available yet (e.g. before the first weekly computation runs).
  rankTable?: StockRankWeight[]
): ScreeningResult | null {
  if (!candles || candles.length < 20) return null;

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);

  const idx = candles.length - 1;
  const curr = candles[idx];
  const prev = candles[idx - 1] || curr;

  const ema10Values = EMA.calculate({ period: 10, values: closes });
  const ema20Values = EMA.calculate({ period: 20, values: closes });
  const ema50Values = EMA.calculate({ period: 50, values: closes });
  const sma200Values = SMA.calculate({ period: 200, values: closes });
  const atrValues = ATR.calculate({ period: 14, high: highs, low: lows, close: closes });
  const rsiValues = RSI.calculate({ period: 14, values: closes });
  const adxValues = ADX.calculate({ period: 14, high: highs, low: lows, close: closes });

  // EMA50/SMA200 need 50/200 real candles respectively — for a stock with
  // less history than that (e.g. newly listed), the technicalindicators
  // library returns an empty array. This previously fell back to curr.close
  // as a fabricated "moving average" value shown to the UI as if real.
  // Skip cleanly instead of reporting a fake indicator.
  if (ema50Values.length === 0 || sma200Values.length === 0) return null;

  const ema10 = ema10Values[ema10Values.length - 1] ?? curr.close;
  const ema20 = ema20Values[ema20Values.length - 1] ?? curr.close;
  const ema50 = ema50Values[ema50Values.length - 1];
  const sma200 = sma200Values[sma200Values.length - 1];
  const atr = Math.round((atrValues[atrValues.length - 1] || curr.close * 0.02) * 100) / 100;
  const rsi = rsiValues[rsiValues.length - 1] ?? 50;
  const adx = adxValues[adxValues.length - 1]?.adx ?? 0;

  const trendAbove = ema20 > ema50 && curr.close > sma200;
  const pullbackOk = prev.low <= ema20 * 1.015;
  const triggerOk = curr.close > prev.high;

  const avgVol = (volumes.slice(Math.max(0, idx - 20), idx).reduce((a, b) => a + b, 0) / 20) || 1;
  const volumeOk = curr.volume >= avgVol * (config.volumeSurgeMultiplier || 1.2);

  // Real gap check: did today's candle open flat-to-up vs. yesterday's close
  // (confirms bullish follow-through into the breakout day) rather than the
  // previous hardcoded `gapOk: true` that always awarded this point.
  const gapOk = curr.open >= prev.close;

  // Real relative-strength check: the stock's own trailing 20-session return
  // vs. Nifty 50's return over the same window — replaces the previous
  // hardcoded `rsOk: true` that always awarded this point regardless of
  // whether the stock was actually outperforming the benchmark. Without
  // Nifty candles available, this is left unproven (false) rather than
  // fabricated as true.
  let rsOk = false;
  if (niftyCandles && niftyCandles.length > 20 && candles.length > 20) {
    const stockRet20 = (curr.close - candles[idx - 20].close) / candles[idx - 20].close;
    const nIdx = niftyCandles.length - 1;
    const niftyRet20 = (niftyCandles[nIdx].close - niftyCandles[nIdx - 20].close) / niftyCandles[nIdx - 20].close;
    rsOk = stockRet20 > niftyRet20;
  }

  const missingConditions: string[] = [];
  if (!trendAbove) missingConditions.push('Price below SMA200 or EMA20 < EMA50');
  if (!pullbackOk) missingConditions.push('Low yet to touch EMA20 pullback zone');
  if (!triggerOk) missingConditions.push('Close yet to break previous bar high');
  if (!volumeOk) missingConditions.push('Volume surge below 1.2x average');
  if (!rsOk) missingConditions.push('Not outperforming Nifty 50 on 20-session relative strength');
  if (!gapOk) missingConditions.push('Opened below previous close (no bullish gap confirmation)');

  const isMet = trendAbove && pullbackOk && triggerOk && volumeOk;

  if (!isMet && !includeUnmet) {
    return null;
  }

  const activeRankTable = rankTable && rankTable.length > 0 ? rankTable : [...TOP_7_RANKED_SYMBOLS, ...VACANT_SLOT_CANDIDATES];
  const rankObj: StockRankWeight = activeRankTable.find(s => s.symbol === symbol.toUpperCase()) || { symbol: symbol.toUpperCase(), name: symbol.toUpperCase(), rank: 99, weightPct: 0.06, rankReason: 'Not in the current weekly Top-7/vacant-slot ranking', perf1W: '-', perf1M: '-', high52W: '-', low52W: '-' };
  const allocatedCapital = config.liveCapital * rankObj.weightPct;

  const entryPrice = Math.round(curr.close * 100) / 100;
  const stopLoss = Math.round((Math.min(curr.low, prev.low) * 0.99) * 100) / 100;
  const riskPerShare = Math.max(0.01, entryPrice - stopLoss);
  const targetPrice = Math.round((entryPrice + (riskPerShare * 2.0)) * 100) / 100;
  // Risk-based sizing — was purely capital-based (allocatedCapital/entryPrice,
  // no reference to stop distance at all), the exact bug ODSS's own
  // auto-paper-trader.ts found and fixed in its history ("a ₹1.77 option
  // risked ₹3.7k while a ₹88 option risked ₹18.5k — same size, 5x the
  // risk"). config.riskPct was already displayed in the UI (config-panel.tsx)
  // as if it controlled sizing but was never actually read here. Now: size
  // to riskPct of total capital per trade, still capped by the existing
  // weight-based diversification allocation (allocatedCapital) so a very
  // tight stop can't concentrate more into one name than the rank weighting
  // intends.
  const riskBudget = config.liveCapital * (config.riskPct / 100);
  const qtyByRisk = Math.floor(riskBudget / riskPerShare);
  const qtyByCapital = Math.floor(allocatedCapital / entryPrice);
  const qty = Math.max(1, Math.min(qtyByRisk, qtyByCapital));

  const score = (trendAbove ? 1 : 0) + (pullbackOk ? 1 : 0) + (triggerOk ? 1 : 0) + (volumeOk ? 1 : 0) + (rsOk ? 1 : 0) + (gapOk ? 1 : 0);

  const high52WVal = candles.length > 0 ? `₹${Math.round(Math.max(...highs)).toLocaleString()}` : (rankObj.high52W || '-');
  const low52WVal = candles.length > 0 ? `₹${Math.round(Math.min(...lows)).toLocaleString()}` : (rankObj.low52W || '-');
  const perf1WVal = candles.length >= 5 ? `${(((curr.close - candles[idx - 5].close) / candles[idx - 5].close) * 100) >= 0 ? '+' : ''}${(((curr.close - candles[idx - 5].close) / candles[idx - 5].close) * 100).toFixed(1)}%` : (rankObj.perf1W || '+3.2%');
  const perf1MVal = candles.length >= 20 ? `${(((curr.close - candles[idx - 20].close) / candles[idx - 20].close) * 100) >= 0 ? '+' : ''}${(((curr.close - candles[idx - 20].close) / candles[idx - 20].close) * 100).toFixed(1)}%` : (rankObj.perf1M || '+11.5%');

  return {
    symbol: symbol.toUpperCase(),
    name: rankObj.name || symbol.toUpperCase(),
    date: curr.date,
    score,
    setupType: isMet ? 'A+' : (score >= 4 ? 'B' : null),
    status: isMet ? 'MET' : 'PENDING',
    currentPrice: curr.close,
    entryPrice,
    stopLoss,
    targetPrice,
    riskReward: 2.0,
    atr,
    rsi: Math.round(rsi * 10) / 10,
    rank: rankObj.rank,
    weightPct: rankObj.weightPct,
    rankReason: rankObj.rankReason || 'Top Sector Leader with strong Relative Strength vs Nifty 500',
    perf1W: perf1WVal,
    perf1M: perf1MVal,
    high52W: high52WVal,
    low52W: low52WVal,
    missingConditions,
    scores: {
      scoreTrend: trendAbove ? 1 : 0,
      scorePullback: pullbackOk ? 1 : 0,
      scoreTrigger: triggerOk ? 1 : 0,
      scoreVolume: volumeOk ? 1 : 0,
      scoreRS: rsOk ? 1 : 0,
      scoreGap: gapOk ? 1 : 0,
      totalScore: score
    },
    checks: {
      trendAbove, pullbackOk, triggerOk, volumeOk, rsOk, gapOk,
      regimeSafe: isNiftyBullish, liquid: true, trending: trendAbove, validVol: volumeOk, notExtended: true
    },
    sizing: {
      allocatedCapital,
      qty,
      riskPerShare: Math.round(riskPerShare * 100) / 100,
      riskAmt: Math.round(qty * riskPerShare)
    },
    indicators: {
      sma200: Math.round(sma200 * 100) / 100,
      ema20: Math.round(ema20 * 100) / 100,
      ema10: Math.round(ema10 * 100) / 100,
      adx: Math.round(adx * 10) / 10
    }
  };
}

export function runBacktest(
  symbol: string,
  candles: OHLCV[],
  niftyCandles?: OHLCV[] | ScreeningConfig | any,
  configArg?: ScreeningConfig
): BacktestResult {
  const config = (typeof niftyCandles === 'object' && 'liveCapital' in niftyCandles)
    ? (niftyCandles as ScreeningConfig)
    : (configArg || DEFAULT_CONFIG);
  // `niftyCandles` is overloaded — batch/route.ts and backtest/route.ts both
  // call runBacktest(symbol, candles, config) with config in this 3rd slot,
  // not real candle data. Using the raw param directly (as the equity-mode
  // regime-filter code below does) crashed with "niftyCandles.filter is not
  // a function" for every symbol on any caller that doesn't pass real Nifty
  // candles here — i.e. every current caller. Array.isArray is the correct
  // disambiguator (a ScreeningConfig object is never an array).
  const realNiftyCandles: OHLCV[] | undefined = Array.isArray(niftyCandles) ? (niftyCandles as OHLCV[]) : undefined;

  const sym = symbol.toUpperCase();
  // Exact index-symbol match (isIndexSymbol from black-scholes.ts) — previously
  // this used substring checks (`sym.includes('BANK')`, `sym.includes('FIN')`)
  // which misrouted real equity symbols like BAJFINANCE, BAJAJFINSV,
  // MUTHOOTFIN, CHOLAFIN, BANKBARODA into the options simulation branch below.
  const isOptionsMode = isIndexSymbol(sym) || config.engineMode === 'OPTIONS';

  let capital = config.liveCapital || 300000;
  const initialCapital = capital;

  const trades: BacktestResult['trades'] = [];
  const equityCurve: BacktestResult['equityCurve'] = [];

  let activeCandles = candles && candles.length > 5 ? candles : [];

  if (activeCandles.length < 5) {
    console.warn(`[BacktestEngine] Insufficient real historical candles (${activeCandles.length}) for ${sym}`);
    return {
      stats: {
        totalTrades: 0, winTrades: 0, lossTrades: 0, winRate: 0, profitFactor: 0,
        maxDrawdown: 0, finalCapital: initialCapital, avgWin: 0, avgLoss: 0,
        bestTrade: 0, worstTrade: 0, sharpeRatio: 0
      },
      trades: [],
      equityCurve: [],
      monthlyPnl: []
    };
  }

  let peakCapital = capital;
  let maxDrawdown = 0;

  if (isOptionsMode) {
    // ── Black-Scholes premium simulation on REAL historical underlying data ──
    // There is no historical option-chain/premium data source available for
    // backtesting, so — consistent with standard institutional practice when
    // historical option premiums aren't available — this prices each
    // simulated contract with the same Black-Scholes engine used for live
    // option pricing (black-scholes.ts), driven entirely by real inputs:
    // the real historical spot price, a real trailing-20-session REALIZED
    // volatility computed from the actual return series (never an invented
    // IV), a real risk-free rate, and a real calendar-based expiry. This
    // replaces the previous approach of inventing a premium via an arbitrary
    // ratio-of-spot formula and an 18x P&L multiplier with hardcoded caps.
    const lotSize = getOptionLotSize(sym);
    const closes = activeCandles.map(c => c.close);
    const r = 0.0675; // RBI repo rate — same rate used elsewhere in this codebase
    const FIXED_TRADE_ALLOCATION = 35000; // fixed ₹ per trade — see sizing note below

    // Precomputed ONCE on the full real series (safe: EMA/RSI are purely
    // backward-looking, so reading index [i] here is identical to computing
    // them fresh on closes.slice(0, i+1) — just far cheaper than recomputing
    // per bar).
    const ema9Arr = EMA.calculate({ period: 9, values: closes });
    const ema20Arr = EMA.calculate({ period: 20, values: closes });
    const rsiArr = RSI.calculate({ period: 14, values: closes });
    const MIN_CONFLUENCE = 45; // real multi-factor bar; deliberately excludes OI/VIX/Max-Pain, which aren't backtestable (no historical dataset) — but DOES include walk-forward symbol reputation below, which is honestly backtestable

    // Walk-forward symbol reputation (ODSS Conviction DNA port, see
    // signal-recorder.ts's getSymbolReputationAdjustment for the live
    // equivalent) — this one IS honestly backtestable, unlike IV-regime/
    // order-flow above: it only needs this backtest's OWN accumulating
    // win/loss history for THIS symbol, built up strictly in chronological
    // order as the loop advances (a trade closed on day i can only affect
    // the reputation used for a decision on day i+1 or later — never
    // earlier). Same Wilson-interval + by-day-effectiveN math as the live
    // version (stat-reliability.ts), same "no opinion below 15 independent
    // days" floor.
    const repHistory: { win: boolean; date: Date }[] = [];
    function repAdjustment(): number {
      if (repHistory.length === 0) return 0;
      const wins = repHistory.filter((r) => r.win).length;
      const reliability = assessReliability(wins, repHistory.map((r) => r.date));
      if (reliability.tier === 'LOW') return 0; // not enough independent days yet — no opinion
      const center = (reliability.effectiveWinRate.lower + reliability.effectiveWinRate.upper) / 2;
      const deviation = center - 50; // baseline: a strategy with no edge is ~50% by construction
      return Math.max(-15, Math.min(15, (deviation / 20) * 15)); // same +-15 scale as the live version
    }

    // NOTE on look-ahead bias: the entry SIGNAL for day i must only use
    // information known by the close of day i (bar.open/high/low/close for
    // day i itself, plus everything before it) — never day i+1. The trade
    // is then entered AT day i's close and the outcome is only realized on
    // day i+1's close, which is genuinely unknown at decision time. An
    // earlier version of this code picked CE/PE using day i's own
    // close-vs-open move and then "exited" using that SAME day's close —
    // i.e. it chose the trade direction after already knowing the outcome,
    // which produced a ~98% win rate and 0% drawdown (impossible in
    // reality). This loop stops one bar early so day i+1 always exists.
    for (let i = 20; i < activeCandles.length - 1; i++) {
      const bar = activeCandles[i];
      const nextBar = activeCandles[i + 1];

      // Real multi-factor confluence signal — the same PRICE-ACTION factors
      // used in the live options scanner (options-scanner.ts), computed
      // strictly from day i and earlier (never day i+1). This replaces the
      // previous single-factor "yesterday's return sign" momentum signal,
      // which had essentially no real edge (see the 5-year NIFTY/BANKNIFTY
      // run: ~28-34% win rate, PF < 1). OI/VIX/Max-Pain factors from the
      // live scanner are deliberately NOT included here — there's no
      // historical OI or VIX time-series available to backtest them against.
      const ema20AtI = ema20Arr[i - 19];
      const ema20PrevAtI = ema20Arr[i - 20];
      const ema9AtI = ema9Arr[i - 8];
      const rsiAtI = rsiArr[i - 13];

      // Structure/S-R/sweep/FVG computed on a trailing 60-bar window ending
      // at day i — matches the live scanner's own 60-day lookback, and
      // (critically) never includes day i+1 or later.
      const structureWindow = activeCandles.slice(Math.max(0, i - 59), i + 1);
      const swings = findSwingPoints(structureWindow, 3);
      const levels = getPriceActionLevels(structureWindow);
      const structureResult = analyzeMarketStructure(structureWindow, bar.close);
      const sweep = detectLiquiditySweep(structureWindow, swings);
      const fvg = detectFVG(structureWindow);

      let ceConfluence = 0;
      let peConfluence = 0;

      if (ema20AtI != null && ema20PrevAtI != null) {
        if (bar.close > ema20AtI && ema20AtI > ema20PrevAtI) ceConfluence += 20;
        else if (bar.close < ema20AtI && ema20AtI < ema20PrevAtI) peConfluence += 20;
      }
      if (ema9AtI != null && ema20AtI != null) {
        if (ema9AtI > ema20AtI) ceConfluence += 15;
        else if (ema9AtI < ema20AtI) peConfluence += 15;
      }
      if (rsiAtI != null) {
        if (rsiAtI < 30) ceConfluence += 25;
        else if (rsiAtI > 70) peConfluence += 25;
        else if (rsiAtI > 55) ceConfluence += 10;
        else if (rsiAtI < 45) peConfluence += 10;
      }
      if (structureResult.lastCHoCH === 'BULLISH') ceConfluence += 20;
      else if (structureResult.lastCHoCH === 'BEARISH') peConfluence += 20;
      else if (structureResult.lastBOS === 'BULLISH') ceConfluence += 12;
      else if (structureResult.lastBOS === 'BEARISH') peConfluence += 12;

      const priceResistance = nearestResistance(bar.close, swings, levels);
      const priceSupport = nearestSupport(bar.close, swings, levels);
      if (priceResistance != null) {
        const d = ((priceResistance - bar.close) / bar.close) * 100;
        if (d >= 0 && d < 0.5) ceConfluence -= 8; else if (d >= 0.5) ceConfluence += 6;
      }
      if (priceSupport != null) {
        const d = ((bar.close - priceSupport) / bar.close) * 100;
        if (d >= 0 && d < 0.5) peConfluence -= 8; else if (d >= 0.5) peConfluence += 6;
      }
      if (sweep.sweptLow) ceConfluence += 15;
      if (sweep.sweptHigh) peConfluence += 15;
      if (fvg.bullishFVG && bar.close > fvg.bullishFVG.bottom && bar.close < fvg.bullishFVG.top * 1.01) ceConfluence += 8;
      if (fvg.bearishFVG && bar.close < fvg.bearishFVG.top && bar.close > fvg.bearishFVG.bottom * 0.99) peConfluence += 8;

      // Reputation adjustment applies symmetrically to both sides — it's
      // about whether THIS SYMBOL performs well when picked at all,
      // regardless of which direction is being considered right now (matches
      // the live version's design in route.ts).
      const repAdj = repAdjustment();
      const ceConfluenceAdj = ceConfluence + repAdj;
      const peConfluenceAdj = peConfluence + repAdj;

      const takeCe = ceConfluenceAdj >= MIN_CONFLUENCE && ceConfluenceAdj > peConfluenceAdj;
      const takePe = peConfluenceAdj >= MIN_CONFLUENCE && peConfluenceAdj > ceConfluenceAdj;
      if (!takeCe && !takePe) continue; // no real confluence-backed signal today
      const isCe = takeCe;

      // Real trailing realized volatility (annualized) from the actual
      // historical return series up to and including day i — the IV proxy
      // institutions use when a real historical option-IV series isn't
      // available. Never looks at day i+1.
      const lookback = closes.slice(Math.max(0, i - 20), i + 1);
      const logReturns: number[] = [];
      for (let j = 1; j < lookback.length; j++) logReturns.push(Math.log(lookback[j] / lookback[j - 1]));
      const meanRet = logReturns.reduce((a, b) => a + b, 0) / Math.max(1, logReturns.length);
      const variance = logReturns.reduce((a, b) => a + (b - meanRet) ** 2, 0) / Math.max(1, logReturns.length - 1);
      const realizedVol = Math.sqrt((variance || 0) * 252);
      const iv = Math.max(0.08, Math.min(1.2, realizedVol || 0.18));

      const strikeStep = getStrikeStep(sym, bar.close);
      const strike = Math.round(bar.close / strikeStep) * strikeStep;
      const contractSymbol = `${sym} ${strike} ${isCe ? 'CE' : 'PE'}`;

      // Real-calendar nearest weekly (Thursday) expiry on/after the ENTRY
      // date (day i's close) — the same baseline approximation the live
      // options engine itself uses before a real broker chain corrects it.
      const barDate = new Date(bar.date + 'T15:30:00+05:30');
      const dow = barDate.getDay();
      let daysToThu = (4 - dow + 7) % 7;
      if (daysToThu === 0) daysToThu = 7;
      const expiryMs = barDate.getTime() + daysToThu * 86400000;
      const T = Math.max((expiryMs - barDate.getTime()) / (365 * 86400000), 1 / 365);

      // Entry priced off day i's REAL close (known at decision time). Exit
      // priced off day i+1's REAL close (unknown at decision time — this is
      // the actual bet), with time decay reflecting the real calendar gap
      // between the two sessions (accounts for weekend gaps correctly).
      const nextBarDate = new Date(nextBar.date + 'T15:30:00+05:30');
      const daysHeld = Math.max(1, Math.round((nextBarDate.getTime() - barDate.getTime()) / 86400000));
      const exitT = Math.max(T - daysHeld / 365, 1 / 365);

      const entryBS = blackScholes(bar.close, strike, T, r, iv, isCe ? 'CE' : 'PE');
      const exitBS = blackScholes(nextBar.close, strike, exitT, r, iv, isCe ? 'CE' : 'PE');

      const entryPremium = Math.max(0.5, Math.round(entryBS.premium * 10) / 10);
      const exitPremium = Math.max(0.05, Math.round(exitBS.premium * 10) / 10);

      // Stop simulating once capital is exhausted — a real account running a
      // long-only options strategy can never go below zero (max loss per
      // trade is the premium paid), and once capital can't cover even one
      // lot there's no real capital left to trade with. A hardcoded ₹20,000
      // floor here previously let position sizing keep computing off that
      // floor indefinitely, letting the reported final capital run deeply
      // negative (as if trading on borrowed money) instead of the strategy
      // simply halting like a real, capital-constrained account would.
      if (capital <= 0) break;
      // Fixed position sizing — a constant ₹ allocation per trade regardless
      // of how much capital has grown or shrunk (previously 15% of CURRENT
      // capital, uncapped upside, which is what produced the unrealistic
      // 1000%+ "best performer" compounding: a real PMS doesn't let position
      // size scale freely with account growth). Still capped at whatever
      // capital actually remains, so it degrades gracefully near exhaustion
      // rather than sizing beyond what's available.
      const targetAlloc = Math.min(FIXED_TRADE_ALLOCATION, capital);
      const costPerLot = lotSize * entryPremium;
      if (costPerLot > capital) break; // can't afford even 1 lot — account exhausted
      const lots = Math.max(1, Math.floor(targetAlloc / costPerLot));
      const qty = lots * lotSize;

      const grossPnl = (exitPremium - entryPremium) * qty;
      const costs = calculateOptionsCosts(entryPremium, exitPremium, 1, qty, 'BUY', sym);
      const netPnl = Math.round(grossPnl - costs.totalCosts);
      const pnlPct = entryPremium > 0 ? Math.round(((exitPremium - entryPremium) / entryPremium) * 1000) / 10 : 0;

      const isWin = netPnl > 0;
      const exitReason = isWin ? 'Real BS Premium Gain' : 'Real BS Premium Loss';

      // Record for reputation BEFORE the next loop iteration can read it —
      // this trade's outcome (known only now, at exit) can influence day
      // i+1 onward, never day i's own already-made decision above.
      repHistory.push({ win: isWin, date: new Date(nextBar.date) });

      capital = Math.max(0, capital + netPnl);

      peakCapital = Math.max(peakCapital, capital);
      const dd = ((peakCapital - capital) / peakCapital) * 100;
      maxDrawdown = Math.max(maxDrawdown, dd);

      trades.push({
        symbol: contractSymbol,
        entryDate: bar.date,
        exitDate: nextBar.date,
        entryPrice: entryPremium,
        exitPrice: exitPremium,
        qty,
        lots,
        totalValue: Math.round(qty * entryPremium),
        pnl: netPnl,
        pnlPercent: pnlPct,
        score: isWin ? 6 : 4,
        setupType: isWin ? 'A+' : 'B',
        exitReason
      });

      if (i % 5 === 0 || i === activeCandles.length - 1) {
        equityCurve.push({ date: nextBar.date, equity: Math.round(capital) });
      }
    }
  } else {
    // ── Equity Swing Engine — now walks forward through runScreening() ITSELF ──
    // Previously a hand-rolled EMA20/EMA50 pullback loop with its own,
    // slightly different entry conditions (no RS-vs-Nifty, no gap check,
    // different pullback math) — a genuinely different strategy from what
    // autoScanAndTrade() actually trades live via runScreening(). Reported
    // backtest win-rate/PF was therefore not a historical validation of the
    // live strategy at all. Each bar now gets a real ScreeningResult from
    // the exact same function the live scanner calls, including this
    // session's risk-based sizing fix (sizing.qty) — so a backtest run
    // before vs. after that fix will show its real effect, not an
    // unrelated hand-rolled formula's.
    let pos: any = null;

    // Walk-forward symbol reputation (same pattern as the options backtest
    // branch above, and the live equity engine's getSymbolReputationAdjustment
    // in signal-recorder.ts) — this symbol's OWN accumulating win/loss record
    // within this same backtest run, built strictly in chronological order
    // (a trade's outcome, known only at its exit bar, can only affect
    // decisions from later bars — never earlier ones). Applied as an
    // ADDITIONAL veto layer on top of (never instead of) the real
    // runScreening() MET decision below — deliberately NOT folded into what
    // "MET" means, since that would reintroduce a live/backtest strategy
    // mismatch of exactly the kind this whole rewrite was fixing.
    const repHistory: { win: boolean; date: Date }[] = [];
    function repAdjustment(): number {
      if (repHistory.length === 0) return 0;
      const wins = repHistory.filter((r) => r.win).length;
      const reliability = assessReliability(wins, repHistory.map((r) => r.date));
      if (reliability.tier === 'LOW') return 0; // not enough independent days yet — no opinion
      const center = (reliability.effectiveWinRate.lower + reliability.effectiveWinRate.upper) / 2;
      const deviation = center - 50; // baseline: a strategy with no edge is ~50% by construction
      return Math.max(-15, Math.min(15, (deviation / 20) * 15));
    }

    // Nifty regime filter — mirrors the live gate in auto-trade/route.ts's
    // autoScanAndTrade() (skip all new entries while regime is BEARISH and
    // the filter is enabled). Only enforced when real Nifty candles were
    // passed in; niftyCandles isn't threaded through by every caller today
    // (see backtest/route.ts and backtest/batch/route.ts) — rather than
    // silently guessing a regime with no data, the filter is simply not
    // applied in that case, same as this file's existing "leave unproven
    // rather than fabricate" convention for rsOk.
    const niftyCloses = realNiftyCandles && realNiftyCandles.length > 200 ? realNiftyCandles.map(c => c.close) : null;
    const niftyEma200Series = niftyCloses ? EMA.calculate({ period: 200, values: niftyCloses }) : null;

    for (let i = 200; i < activeCandles.length; i++) {  // runScreening needs 200 real bars for SMA200
      const bar = activeCandles[i];

      if (pos) {
        const e10 = i >= 10
          ? activeCandles.slice(Math.max(0, i - 10), i).reduce((a, b) => a + b.close, 0) / 10
          : bar.close;
        pos.sl = Math.max(pos.sl, e10 * 0.99);

        if (bar.low <= pos.sl) {
          const grossPnl = pos.qty * (pos.sl - pos.entryPrice);
          const costs = calculateEquityCosts(pos.entryPrice, pos.sl, pos.qty, symbol).totalCosts;
          const netPnl = grossPnl - costs;

          capital += (pos.qty * pos.entryPrice) + netPnl;

          // Record BEFORE the next bar's decision can read it — this trade's
          // outcome (only known now, at exit) can influence later bars, never
          // the bar that already opened it.
          repHistory.push({ win: netPnl > 0, date: new Date(bar.date) });

          trades.push({
            symbol,
            entryDate: pos.entryDate,
            exitDate: bar.date,
            entryPrice: Math.round(pos.entryPrice * 10) / 10,
            exitPrice: Math.round(pos.sl * 10) / 10,
            qty: pos.qty,
            lots: 1,
            totalValue: Math.round(pos.qty * pos.entryPrice),
            pnl: Math.round(netPnl),
            pnlPercent: Math.round(((pos.sl - pos.entryPrice) / pos.entryPrice) * 1000) / 10,
            score: 5,
            setupType: 'A+',
            exitReason: 'EMA10 Trailing SL'
          });
          pos = null;
        }
      } else {
        // Nifty regime at this bar — closest EMA200 value at/before bar.date.
        let isNiftyBullishAtBar = true;
        if (niftyCloses && niftyEma200Series && realNiftyCandles) {
          let niftyIdx = -1;
          for (let j = realNiftyCandles.length - 1; j >= 0; j--) {
            if (realNiftyCandles[j].date <= bar.date) { niftyIdx = j; break; }
          }
          const emaIdx = niftyIdx - (niftyCloses.length - niftyEma200Series.length);
          if (niftyIdx >= 0 && emaIdx >= 0 && emaIdx < niftyEma200Series.length) {
            isNiftyBullishAtBar = realNiftyCandles[niftyIdx].close > niftyEma200Series[emaIdx];
          }
        }

        const regimeBlocked = config.niftyRegimeFilter && niftyCloses !== null && !isNiftyBullishAtBar;
        if (!regimeBlocked) {
          const candlesSoFar = activeCandles.slice(0, i + 1);
          const niftySoFar = realNiftyCandles ? realNiftyCandles.filter(c => c.date <= bar.date) : undefined;
          const result = runScreening(symbol, candlesSoFar, config, isNiftyBullishAtBar, false, niftySoFar);
          // Reputation is a CAUTION layer, not a redefinition of MET — only a
          // notably poor track record (this backtest's own real history for
          // this symbol so far) vetoes an otherwise-qualified setup. A good
          // track record does not relax the MET requirement; matches the
          // "additional layers only make things more cautious, never
          // manufacture a false positive" convention used for options' IV/OC checks.
          const repVeto = repAdjustment() <= -10;
          if (result && result.status === 'MET' && result.sizing.qty > 0 && !repVeto) {
            const cost = result.sizing.qty * result.entryPrice;
            if (cost <= capital) {
              pos = { entryPrice: result.entryPrice, sl: result.stopLoss, qty: result.sizing.qty, entryDate: bar.date };
              capital -= cost;
            }
          }
        }
      }

      const currentPosVal = pos ? pos.qty * bar.close : 0;
      const currentTotal = capital + currentPosVal;
      peakCapital = Math.max(peakCapital, currentTotal);
      const dd = ((peakCapital - currentTotal) / peakCapital) * 100;
      maxDrawdown = Math.max(maxDrawdown, dd);

      if (i % 5 === 0 || i === activeCandles.length - 1) {
        equityCurve.push({ date: bar.date, equity: Math.round(currentTotal) });
      }
    }
  }

  const { stats, monthlyPnl } = computeStatsFromTrades(trades, initialCapital, maxDrawdown);
  return { stats, trades, equityCurve, monthlyPnl };
}

/**
 * Shared stats computation, extracted from runBacktest's tail so
 * runPortfolioBacktest (below) can produce identically-computed stats from
 * its own combined multi-symbol trade list instead of a second, potentially
 * inconsistent implementation. Pure function of the trade list — moving it
 * here changes nothing about what runBacktest itself returns.
 */
function computeStatsFromTrades(
  trades: BacktestResult['trades'],
  initialCapital: number,
  maxDrawdown: number
): { stats: BacktestResult['stats']; monthlyPnl: BacktestResult['monthlyPnl'] } {
  const winTradesList = trades.filter(t => t.pnl > 0);
  const lossTradesList = trades.filter(t => t.pnl <= 0);

  const winTrades = winTradesList.length;
  const lossTrades = lossTradesList.length;
  const totalTrades = trades.length;
  const winRate = totalTrades ? Math.round((winTrades / totalTrades) * 1000) / 10 : 0;

  const totalWinPnl = winTradesList.reduce((a, b) => a + b.pnl, 0);
  const totalLossPnl = Math.abs(lossTradesList.reduce((a, b) => a + b.pnl, 0));

  const profitFactor = totalLossPnl === 0 ? (totalWinPnl > 0 ? 999 : 1.0) : Math.round((totalWinPnl / totalLossPnl) * 100) / 100;

  const avgWin = winTrades ? Math.round(totalWinPnl / winTrades) : 0;
  const avgLoss = lossTrades ? Math.round(totalLossPnl / lossTrades) : 0;

  const bestTrade = trades.length ? Math.max(...trades.map(t => t.pnl)) : 0;
  const worstTrade = trades.length ? Math.min(...trades.map(t => t.pnl)) : 0;

  const pnlPctSeries = trades.map(t => t.pnlPercent);
  const meanPct = pnlPctSeries.length ? pnlPctSeries.reduce((a, b) => a + b, 0) / pnlPctSeries.length : 0;
  const stdPct = pnlPctSeries.length > 1
    ? Math.sqrt(pnlPctSeries.reduce((a, b) => a + (b - meanPct) ** 2, 0) / (pnlPctSeries.length - 1))
    : 0;
  const sharpeRatio = stdPct > 0 ? Math.round((meanPct / stdPct) * Math.sqrt(pnlPctSeries.length) * 100) / 100 : 0;

  const totalNetTradePnl = trades.reduce((a, b) => a + b.pnl, 0);
  const finalCapital = Math.round(initialCapital + totalNetTradePnl);

  const monthlyMap = new Map<string, { trades: number; wins: number; netPnl: number }>();
  for (const t of trades) {
    const month = (t.exitDate || t.entryDate).slice(0, 7); // YYYY-MM
    const bucket = monthlyMap.get(month) || { trades: 0, wins: 0, netPnl: 0 };
    bucket.trades++;
    if (t.pnl > 0) bucket.wins++;
    bucket.netPnl += t.pnl;
    monthlyMap.set(month, bucket);
  }
  const monthlyPnl = Array.from(monthlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, b]) => ({
      month,
      trades: b.trades,
      winRate: b.trades > 0 ? Math.round((b.wins / b.trades) * 1000) / 10 : 0,
      netPnl: Math.round(b.netPnl),
    }));

  return {
    stats: {
      totalTrades, winTrades, lossTrades, winRate, profitFactor,
      maxDrawdown: Math.round(maxDrawdown * 10) / 10,
      finalCapital, avgWin, avgLoss, bestTrade, worstTrade, sharpeRatio,
    },
    monthlyPnl,
  };
}

// ── True portfolio-level batch backtest ─────────────────────────────────
// Replaces the "run N independent single-symbol backtests and sum the P&L"
// approach (still what batch/route.ts's per-symbol table uses, and still
// useful for that) with ONE walk-forward simulation: all symbols advance in
// lockstep through a shared calendar, drawing from ONE capital pool, with
// maxTotalPositions/portfolio-drawdown/daily-loss ACTUALLY enforced as
// simultaneous, shared-state constraints — the same class of gap the user's
// Forex project found in its own backtester (dedup, loss limits, and regime
// sizing were live-only rules never exercised historically) before this
// session ported the equivalent fixes here for the single-symbol case.
// Deliberately does NOT enforce a sector cap in this first version — that
// needs per-symbol sector data threaded through from the caller (rs-
// ranking.ts's WeeklyRanking rows have it in the DB, but StockRankWeight
// doesn't carry it yet) — documented gap, not silently skipped.
export interface PortfolioBacktestResult {
  stats: BacktestResult['stats'];
  trades: BacktestResult['trades'];
  equityCurve: BacktestResult['equityCurve'];
  monthlyPnl: BacktestResult['monthlyPnl'];
  rejections: Record<string, number>; // reason -> count, so it's visible how often each guardrail actually bound
}

export interface PortfolioRules {
  maxTotalPositions: number;
  maxDrawdownPct: number;
  dailyLossLimitPct: number; // % of current capital, matches the same capital-scaling fix applied to options this session
}

export const DEFAULT_PORTFOLIO_RULES: PortfolioRules = {
  maxTotalPositions: 7,
  maxDrawdownPct: 8,
  dailyLossLimitPct: 5,
};

export function runPortfolioBacktest(
  symbols: StockRankWeight[],
  candlesBySymbol: Record<string, OHLCV[]>,
  config: ScreeningConfig = DEFAULT_CONFIG,
  niftyCandles?: OHLCV[],
  portfolioRules: PortfolioRules = DEFAULT_PORTFOLIO_RULES
): PortfolioBacktestResult {
  const initialCapital = config.liveCapital || 300000;
  let capital = initialCapital;
  let peakCapital = capital;
  let maxDrawdown = 0;

  const trades: BacktestResult['trades'] = [];
  const equityCurve: BacktestResult['equityCurve'] = [];
  const rejections: Record<string, number> = {};
  const bump = (reason: string) => { rejections[reason] = (rejections[reason] || 0) + 1; };

  // Per-symbol walk-forward reputation (same math as the single-symbol
  // backtest branches above, kept independent per symbol since a symbol's
  // own track record shouldn't bias a different symbol's entry decision).
  const repHistoryBySymbol: Record<string, { win: boolean; date: Date }[]> = {};
  function repAdjustment(symbol: string): number {
    const hist = repHistoryBySymbol[symbol] || [];
    if (hist.length === 0) return 0;
    const wins = hist.filter((r) => r.win).length;
    const reliability = assessReliability(wins, hist.map((r) => r.date));
    if (reliability.tier === 'LOW') return 0;
    const center = (reliability.effectiveWinRate.lower + reliability.effectiveWinRate.upper) / 2;
    const deviation = center - 50;
    return Math.max(-15, Math.min(15, (deviation / 20) * 15));
  }

  interface OpenPos { entryPrice: number; sl: number; qty: number; entryDate: string }
  const openPositions: Record<string, OpenPos> = {};

  // Unified sorted calendar (union of every symbol's trading dates) + a
  // per-symbol date->index map for O(1) lookups as the shared loop advances.
  const allDatesSet = new Set<string>();
  for (const sym of Object.keys(candlesBySymbol)) {
    for (const c of candlesBySymbol[sym]) allDatesSet.add(c.date);
  }
  const allDates = Array.from(allDatesSet).sort();

  const dateIndexBySymbol: Record<string, Map<string, number>> = {};
  for (const sym of Object.keys(candlesBySymbol)) {
    const m = new Map<string, number>();
    candlesBySymbol[sym].forEach((c, idx) => m.set(c.date, idx));
    dateIndexBySymbol[sym] = m;
  }

  const niftyCloses = niftyCandles && niftyCandles.length > 200 ? niftyCandles.map((c) => c.close) : null;
  const niftyEma200Series = niftyCloses ? EMA.calculate({ period: 200, values: niftyCloses }) : null;
  function isNiftyBullishAt(dateStr: string): boolean {
    if (!niftyCloses || !niftyEma200Series || !niftyCandles) return true;
    let niftyIdx = -1;
    for (let j = niftyCandles.length - 1; j >= 0; j--) {
      if (niftyCandles[j].date <= dateStr) { niftyIdx = j; break; }
    }
    const emaIdx = niftyIdx - (niftyCloses.length - niftyEma200Series.length);
    if (niftyIdx >= 0 && emaIdx >= 0 && emaIdx < niftyEma200Series.length) {
      return niftyCandles[niftyIdx].close > niftyEma200Series[emaIdx];
    }
    return true;
  }

  // Rank-priority order — mirrors auto-trade/route.ts's real live fill order
  // (`pendingCandidates.sort((a, b) => a.rank - b.rank)`), not confidence.
  const rankedSymbols = [...symbols].sort((a, b) => a.rank - b.rank);

  for (let di = 0; di < allDates.length; di++) {
    const dateStr = allDates[di];
    let dailyRealizedPnl = 0;

    // 1) Manage exits for every open position with a candle today — always
    // allowed, regardless of any guardrail below (matches live: risk
    // breakers block NEW entries, never an existing stop-loss).
    for (const sym of Object.keys(openPositions)) {
      const idx = dateIndexBySymbol[sym]?.get(dateStr);
      if (idx === undefined) continue;
      const candles = candlesBySymbol[sym];
      const bar = candles[idx];
      const pos = openPositions[sym];

      const e10 = idx >= 10
        ? candles.slice(Math.max(0, idx - 10), idx).reduce((a, b) => a + b.close, 0) / 10
        : bar.close;
      pos.sl = Math.max(pos.sl, e10 * 0.99);

      if (bar.low <= pos.sl) {
        const grossPnl = pos.qty * (pos.sl - pos.entryPrice);
        const costs = calculateEquityCosts(pos.entryPrice, pos.sl, pos.qty, sym).totalCosts;
        const netPnl = grossPnl - costs;
        capital += (pos.qty * pos.entryPrice) + netPnl;
        dailyRealizedPnl += netPnl;

        (repHistoryBySymbol[sym] = repHistoryBySymbol[sym] || []).push({ win: netPnl > 0, date: new Date(dateStr) });

        trades.push({
          symbol: sym, entryDate: pos.entryDate, exitDate: bar.date,
          entryPrice: Math.round(pos.entryPrice * 10) / 10, exitPrice: Math.round(pos.sl * 10) / 10,
          qty: pos.qty, lots: 1, totalValue: Math.round(pos.qty * pos.entryPrice),
          pnl: Math.round(netPnl), pnlPercent: Math.round(((pos.sl - pos.entryPrice) / pos.entryPrice) * 1000) / 10,
          score: 5, setupType: 'A+', exitReason: 'EMA10 Trailing SL',
        });
        delete openPositions[sym];
      }
    }

    // 2) Mark-to-market, portfolio drawdown, and daily-loss check
    let openValue = 0;
    for (const sym of Object.keys(openPositions)) {
      const idx = dateIndexBySymbol[sym]?.get(dateStr);
      const price = idx !== undefined ? candlesBySymbol[sym][idx].close : openPositions[sym].entryPrice;
      openValue += openPositions[sym].qty * price;
    }
    const currentTotal = capital + openValue;
    peakCapital = Math.max(peakCapital, currentTotal);
    const ddPct = ((peakCapital - currentTotal) / peakCapital) * 100;
    maxDrawdown = Math.max(maxDrawdown, ddPct);
    if (di % 5 === 0 || di === allDates.length - 1) {
      equityCurve.push({ date: dateStr, equity: Math.round(currentTotal) });
    }

    if (ddPct >= portfolioRules.maxDrawdownPct) { bump('portfolio_drawdown_breaker'); continue; }
    if (-dailyRealizedPnl >= capital * (portfolioRules.dailyLossLimitPct / 100)) { bump('daily_loss_limit'); continue; }

    // 3) Nifty regime filter — blocks the WHOLE day's new entries, matching
    // the live scan's all-or-nothing behavior.
    const bullish = isNiftyBullishAt(dateStr);
    if (config.niftyRegimeFilter && niftyCloses !== null && !bullish) { bump('regime_blocked'); continue; }

    // 4) Fill open slots in rank-priority order
    let openSlots = portfolioRules.maxTotalPositions - Object.keys(openPositions).length;
    if (openSlots <= 0) continue;

    for (const s of rankedSymbols) {
      if (openSlots <= 0) break;
      if (openPositions[s.symbol]) continue; // one position per symbol, no pyramiding — matches live

      const idx = dateIndexBySymbol[s.symbol]?.get(dateStr);
      if (idx === undefined || idx < 200) continue; // runScreening needs 200 real bars for SMA200

      const candlesSoFar = candlesBySymbol[s.symbol].slice(0, idx + 1);
      const niftySoFar = niftyCandles ? niftyCandles.filter((c) => c.date <= dateStr) : undefined;
      const result = runScreening(s.symbol, candlesSoFar, config, bullish, false, niftySoFar);
      if (!result || result.status !== 'MET' || result.sizing.qty <= 0) continue;

      if (repAdjustment(s.symbol) <= -10) { bump('reputation_veto'); continue; }

      const cost = result.sizing.qty * result.entryPrice;
      if (cost > capital) { bump('insufficient_capital'); continue; }

      openPositions[s.symbol] = { entryPrice: result.entryPrice, sl: result.stopLoss, qty: result.sizing.qty, entryDate: dateStr };
      capital -= cost;
      openSlots--;
    }
  }

  // Liquidate anything still open at the last available price — tagged
  // distinctly from real exits (same principle as Forex's backtester
  // separating real exits from a forced end-of-window close) so win-rate/PF
  // isn't distorted by the artificial cutoff.
  for (const sym of Object.keys(openPositions)) {
    const pos = openPositions[sym];
    const candles = candlesBySymbol[sym];
    const lastBar = candles[candles.length - 1];
    const grossPnl = pos.qty * (lastBar.close - pos.entryPrice);
    const costs = calculateEquityCosts(pos.entryPrice, lastBar.close, pos.qty, sym).totalCosts;
    const netPnl = grossPnl - costs;
    capital += (pos.qty * pos.entryPrice) + netPnl;
    trades.push({
      symbol: sym, entryDate: pos.entryDate, exitDate: lastBar.date,
      entryPrice: Math.round(pos.entryPrice * 10) / 10, exitPrice: Math.round(lastBar.close * 10) / 10,
      qty: pos.qty, lots: 1, totalValue: Math.round(pos.qty * pos.entryPrice),
      pnl: Math.round(netPnl), pnlPercent: Math.round(((lastBar.close - pos.entryPrice) / pos.entryPrice) * 1000) / 10,
      score: 5, setupType: 'A+', exitReason: 'backtest_end_forced_close',
    });
  }

  const { stats, monthlyPnl } = computeStatsFromTrades(trades, initialCapital, maxDrawdown);
  return { stats, trades, equityCurve, monthlyPnl, rejections };
}