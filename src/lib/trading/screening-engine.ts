/**
 * V-Swing Screening Engine v65.5
 * Ported from Pine Script to TypeScript
 * 
 * This engine replicates the exact logic from the TradingView strategy
 * for scanning NSE stocks based on 6-factor confluence scoring.
 */

import {
  SMA, EMA, RSI, ATR, ADX, WMA
} from 'technicalindicators';

// ── Types ──────────────────────────────────────────────────

export interface OHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

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
}

export const DEFAULT_CONFIG: ScreeningConfig = {
  liveCapital: 200000,
  riskPct: 1.0,
  maxSlots: 8,
  maxOpenTrades: 3,
  maxHoldBars: 25,
  minScore: 2,
  minRR: 1.0,
  cooldownBars: 0,
  useMacro: true,
  minTurnoverCr: 25.0,
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
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  riskReward: number;
  atr: number;
  rsi: number;
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
    qtyA: number;  // A+ setup qty
    qtyB: number;  // B setup qty
    riskPerShareA: number;
    riskPerShareB: number;
    riskAmtA: number;
    riskAmtB: number;
  };
  indicators: {
    sma200: number;
    ema20: number;
    ema10: number;
    adx: number;
    diPlus: number;
    diMinus: number;
  };
}

// ── Helper: lookback with index safety ──────────────────────

function get<T>(arr: T[], index: number, fallback: T): T {
  if (index < 0 || index >= arr.length) return fallback;
  return arr[index];
}

// ── Core Engine ────────────────────────────────────────────

export function runScreening(
  symbol: string,
  candles: OHLCV[],
  niftyCandles: OHLCV[],
  config: ScreeningConfig = DEFAULT_CONFIG
): ScreeningResult | null {
  const len = candles.length;
  if (len < 250) return null; // Need enough data for SMA 200

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);

  // ── Indicators ─────────────────────────────────────────
  const sma200Arr = SMA.calculate({ period: 200, values: closes });
  const ema20Arr = EMA.calculate({ period: 20, values: closes });
  const ema10Arr = EMA.calculate({ period: 10, values: closes });
  const rsi14Arr = RSI.calculate({ period: 14, values: closes });
  const atr14Arr = ATR.calculate({ period: 14, high: highs, low: lows, close: closes });
  const dmiResult = ADX.calculate({ period: 14, high: highs, low: lows, close: closes });

  // Pad arrays to match candle length
  const sma200 = padArray(sma200Arr, len);
  const ema20 = padArray(ema20Arr, len);
  const ema10 = padArray(ema10Arr, len);
  const rsi14 = padArray(rsi14Arr, len);
  const atr14 = padArray(atr14Arr, len);
  const adxArr = dmiResult.map(d => d.adx);
  const diPlusArr = dmiResult.map(d => d.pdi);
  const diMinusArr = dmiResult.map(d => d.mdi);
  const adx = padArray(adxArr, len);
  const diPlus = padArray(diPlusArr, len);
  const diMinus = padArray(diMinusArr, len);

  // ── Current bar (last bar) ─────────────────────────────
  const i = len - 1; // current bar index
  const i1 = len - 2; // previous bar

  // Need at least 2 bars of valid indicator data
  if (!sma200[i] || !ema20[i] || !atr14[i] || !rsi14[i] || !adx[i]) return null;

  const currentClose = closes[i];
  const currentOpen = candles[i].open;
  const currentHigh = highs[i];
  const currentLow = lows[i];
  const currentVolume = volumes[i];
  const prevHigh = get(highs, i1, currentHigh);

  // ── Adaptive range (ATR-based lookback) ────────────────
  const atrSma20 = calcSMA(atr14.slice(0, i + 1).filter(v => v != null), 20);
  const currentAtr = atr14[i]!;
  const rangeLen = currentAtr > atrSma20 ? 30 : 60;

  const structHigh = Math.max(...highs.slice(Math.max(0, i - rangeLen), i));
  const structLow = Math.min(...lows.slice(Math.max(0, i - rangeLen), i));

  // ── ADX / Trending check ──────────────────────────────
  const prevAdx = get(adx, i1, 0);
  const adxRising = adx[i]! > prevAdx;
  const adxHealthy = adx[i]! > 15;
  const marketTrending = (adx[i]! > 18) || (adxRising && adxHealthy);

  // ── Volatility check ───────────────────────────────────
  const volLo = marketTrending ? 0.6 : 0.8;
  const volHi = marketTrending ? 1.8 : 1.3;
  const validVolatility = currentAtr > (atrSma20 * volLo) && currentAtr < (atrSma20 * volHi);

  // ── Macro / Nifty check ────────────────────────────────
  let regimeSafe = true;
  if (config.useMacro && niftyCandles.length >= 200) {
    const niftyCloses = niftyCandles.map(c => c.close);
    const nifty200Arr = SMA.calculate({ period: 200, values: niftyCloses });
    const nifty200 = nifty200Arr[nifty200Arr.length - 1];
    regimeSafe = nifty200 != null && currentClose > nifty200;
  }

  // ── Liquidity check ────────────────────────────────────
  const turnoverCr = (currentClose * currentVolume) / 10000000;
  const turnoverMA20 = calcSMA(
    candles.slice(Math.max(0, i - 20), i).map(c => (c.close * c.volume) / 10000000),
    20
  );
  const liquid = turnoverMA20 >= config.minTurnoverCr;

  // ── Volume MA ─────────────────────────────────────────
  const volMA20 = calcSMA(volumes.slice(Math.max(0, i - 20), i + 1), 20);
  const minLiquidityCheck = currentVolume > volMA20;

  // ── Not extended check ─────────────────────────────────
  const notExtended = currentClose < (ema20[i]! * 1.06);

  // ── Confluence Scores (exact Pine Script logic) ────────

  // Score 1: Trend
  const scoreTrend = (currentClose > sma200[i]! && rsi14[i]! > 52) ? 1 : 0;

  // Score 2: Pullback
  const lowest4 = Math.min(...lows.slice(Math.max(0, i - 4), i + 1));
  const scorePullback = (lowest4 < ema20[i]! * 1.02 && currentClose > ema20[i]!) ? 1 : 0;

  // Score 3: Trigger
  const scoreTrigger = currentClose > prevHigh ? 1 : 0;

  // Score 4: Volume
  const prevVolMA20 = calcSMA(volumes.slice(Math.max(0, i1 - 20), i1 + 1), 20);
  const scoreVolume = (currentVolume > volMA20 * 1.05 || get(volumes, i1, 0) > prevVolMA20 * 1.1) ? 1 : 0;

  // Score 5: Relative Strength (vs Nifty)
  let scoreRS = 0;
  if (niftyCandles.length >= 20) {
    const niftyClose = niftyCandles[niftyCandles.length - 1]?.close ?? 0;
    if (niftyClose > 0) {
      // Calculate rolling RS for last 25 bars
      const rsWindow = Math.min(25, candles.length, niftyCandles.length);
      const rsValues: number[] = [];
      for (let j = len - rsWindow; j < len; j++) {
        const nj = niftyCandles.length - rsWindow + (j - (len - rsWindow));
        if (nj >= 0 && niftyCandles[nj]?.close > 0) {
          rsValues.push(closes[j] / niftyCandles[nj].close);
        }
      }
      const rsMA = calcSMA(rsValues, 20);
      const currentRS = closes[i] / niftyClose;
      const rs5ago = rsValues.length > 5 ? rsValues[rsValues.length - 6] : 0;
      scoreRS = (currentRS > rsMA || currentRS > rs5ago) ? 1 : 0;
    }
  }

  // Score 6: Gap
  const prevClose = get(closes, i1, currentClose);
  const gapPct = Math.abs(currentOpen - prevClose) / prevClose * 100;
  const scoreGap = gapPct < 3.5 ? 1 : 0;

  const totalScore = scoreTrend + scorePullback + scoreTrigger + scoreVolume + scoreRS + scoreGap;

  // ── Regime Clear check ─────────────────────────────────
  const regimeClear = regimeSafe && liquid && minLiquidityCheck && marketTrending && validVolatility && notExtended;

  // ── Entry / SL / TP calculation ────────────────────────
  const theoreticalEP = Math.max(currentOpen, prevHigh);
  const stopLow5 = Math.min(...lows.slice(Math.max(0, i - 5), i));
  const rawSL = stopLow5 - (get(atr14, i1, currentAtr) * 0.8);
  const riskPerShare = theoreticalEP - rawSL;

  if (riskPerShare <= 0) return null;

  const structRange = structHigh - structLow;
  const expectedReward = structRange;
  const rr = expectedReward / riskPerShare;

  if (rr < config.minRR && totalScore < 6) return null;

  // ── Position Sizing ────────────────────────────────────
  const tp1 = theoreticalEP + (riskPerShare * 1.5);

  // A+ sizing
  const riskAmtA = config.liveCapital * (config.riskPct / 100);
  const qtyRiskA = Math.floor(riskAmtA / (riskPerShare * 1)); // pointvalue = 1 for NSE cash
  const qtyCapA = Math.floor((config.liveCapital / config.maxSlots) / theoreticalEP);
  const qtyA = Math.max(0, Math.min(qtyRiskA, qtyCapA));

  // B sizing (half risk, 60% capital)
  const riskAmtB = config.liveCapital * ((config.riskPct * 0.5) / 100);
  const qtyRiskB = Math.floor(riskAmtB / (riskPerShare * 1));
  const qtyCapB = Math.floor(((config.liveCapital / config.maxSlots) * 0.6) / theoreticalEP);
  const qtyB = Math.max(0, Math.min(qtyRiskB, qtyCapB));

  // ── Final assembly ─────────────────────────────────────
  if (totalScore < config.minScore) return null;
  if (!regimeClear) return null;

  // Strong momentum check (gap < 5% for score 6)
  const strongMomentum = totalScore === 6 && gapPct < 5.0;
  const withinGap = currentOpen <= (prevHigh * 1.03);
  if (!withinGap && !strongMomentum) return null;

  return {
    symbol,
    date: candles[i].date,
    score: totalScore,
    setupType: totalScore === 6 ? 'A+' : 'B',
    entryPrice: Math.round(theoreticalEP * 100) / 100,
    stopLoss: Math.round(rawSL * 100) / 100,
    targetPrice: Math.round(tp1 * 100) / 100,
    riskReward: Math.round(rr * 100) / 100,
    atr: Math.round(currentAtr * 100) / 100,
    rsi: Math.round(rsi14[i]! * 100) / 100,
    scores: {
      scoreTrend,
      scorePullback,
      scoreTrigger,
      scoreVolume,
      scoreRS,
      scoreGap,
      totalScore,
    },
    checks: {
      trendAbove: scoreTrend === 1,
      pullbackOk: scorePullback === 1,
      triggerOk: scoreTrigger === 1,
      volumeOk: scoreVolume === 1,
      rsOk: scoreRS === 1,
      gapOk: scoreGap === 1,
      regimeSafe,
      liquid,
      trending: marketTrending,
      validVol: validVolatility,
      notExtended,
    },
    sizing: {
      qtyA,
      qtyB,
      riskPerShareA: Math.round(riskPerShare * 100) / 100,
      riskPerShareB: Math.round(riskPerShare * 100) / 100,
      riskAmtA: Math.round(riskAmtA),
      riskAmtB: Math.round(riskAmtB),
    },
    indicators: {
      sma200: Math.round(sma200[i]! * 100) / 100,
      ema20: Math.round(ema20[i]! * 100) / 100,
      ema10: Math.round(get(ema10, i, 0) * 100) / 100,
      adx: Math.round(adx[i]! * 100) / 100,
      diPlus: Math.round(get(diPlus, i, 0) * 100) / 100,
      diMinus: Math.round(get(diMinus, i, 0) * 100) / 100,
    },
  };
}

// ── Backtest Engine ─────────────────────────────────────────

export interface BacktestTradeResult {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  qty: number;
  pnl: number;
  pnlPercent: number;
  score: number;
  setupType: string;
  exitReason: string;
}

export interface BacktestResult {
  trades: BacktestTradeResult[];
  equityCurve: { date: string; equity: number }[];
  stats: {
    totalTrades: number;
    winTrades: number;
    lossTrades: number;
    winRate: number;
    profitFactor: number;
    maxDrawdown: number;
    avgWin: number;
    avgLoss: number;
    bestTrade: number;
    worstTrade: number;
    finalCapital: number;
    sharpeRatio: number;
  };
}

export function runBacktest(
  symbol: string,
  candles: OHLCV[],
  niftyCandles: OHLCV[],
  config: ScreeningConfig = DEFAULT_CONFIG
): BacktestResult {
  const { maxSlots, maxOpenTrades, maxHoldBars, riskPct, liveCapital } = config;
  const trades: BacktestTradeResult[] = [];
  const equityCurve: { date: string; equity: number }[] = [];
  
  let capital = liveCapital;
  let peakEquity = capital;
  let maxDD = 0;
  let lastTradeBar = -999;

  // Track open positions for pyramiding
  interface OpenPosition {
    entryBar: number;
    entryPrice: number;
    qty: number;
    stopLoss: number;
    tp1: number;
    score: number;
    setupType: string;
    partialTaken: boolean;
    trailActive: boolean;
    totalQty: number;
    avgPrice: number;
    blendedSL: number;
  }
  let openPositions: OpenPosition[] = [];

  // Pre-compute all indicators for the full dataset
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);

  const sma200Full = padArray(SMA.calculate({ period: 200, values: closes }), candles.length);
  const ema20Full = padArray(EMA.calculate({ period: 20, values: closes }), candles.length);
  const ema10Full = padArray(EMA.calculate({ period: 10, values: closes }), candles.length);
  const rsi14Full = padArray(RSI.calculate({ period: 14, values: closes }), candles.length);
  const atr14Full = padArray(ATR.calculate({ period: 14, high: highs, low: lows, close: closes }), candles.length);
  const adxResultFull = ADX.calculate({ period: 14, high: highs, low: lows, close: closes });
  const adxFull = padArray(adxResultFull.map(d => d.adx), candles.length);

  // Nifty data
  let nifty200Full: (number | null)[] = [];
  if (niftyCandles.length >= 200) {
    const nCloses = niftyCandles.map(c => c.close);
    nifty200Full = padArray(SMA.calculate({ period: 200, values: nCloses }), niftyCandles.length);
  }

  // Walk through each bar
  for (let barIdx = 201; barIdx < candles.length; barIdx++) {
    const bar = candles[barIdx];
    
    // Check exits for all open positions
    const closedIndices: number[] = [];
    for (let p = 0; p < openPositions.length; p++) {
      const pos = openPositions[p];
      const barsHeld = barIdx - pos.entryBar;
      
      // Partial TP check
      if (!pos.partialTaken && bar.high >= pos.tp1) {
        const closeQty = Math.ceil(pos.totalQty * 0.3);
        const pnl = closeQty * (pos.tp1 - pos.avgPrice);
        capital += pnl + closeQty * pos.avgPrice;
        pos.totalQty -= closeQty;
        pos.trailActive = true;
        pos.partialTaken = true;
      }

      // Trailing stop
      if (pos.trailActive) {
        const trailLow5 = Math.min(...lows.slice(Math.max(0, barIdx - 5), barIdx + 1));
        const dynamicTrail = Math.max(
          (ema10Full[barIdx] ?? pos.avgPrice) - (atr14Full[barIdx] ?? 0),
          trailLow5
        );
        pos.blendedSL = Math.max(pos.blendedSL, pos.avgPrice, dynamicTrail);
      }

      // SL hit
      if (bar.low <= pos.blendedSL && pos.totalQty > 0) {
        const pnl = pos.totalQty * (pos.blendedSL - pos.avgPrice);
        capital += pnl + pos.totalQty * pos.avgPrice;
        trades.push({
          symbol,
          entryDate: candles[pos.entryBar].date,
          entryPrice: pos.avgPrice,
          exitDate: bar.date,
          exitPrice: pos.blendedSL,
          qty: pos.totalQty,
          pnl: Math.round(pnl * 100) / 100,
          pnlPercent: Math.round((pnl / (pos.totalQty * pos.avgPrice)) * 10000) / 100,
          score: pos.score,
          setupType: pos.setupType,
          exitReason: pos.trailActive ? 'TRAIL_STOP' : 'SL_HIT',
        });
        closedIndices.push(p);
        continue;
      }

      // Dead capital exit
      if (barsHeld > maxHoldBars && !pos.trailActive && pos.totalQty > 0) {
        const pnl = pos.totalQty * (bar.close - pos.avgPrice);
        capital += pnl + pos.totalQty * pos.avgPrice;
        trades.push({
          symbol,
          entryDate: candles[pos.entryBar].date,
          entryPrice: pos.avgPrice,
          exitDate: bar.date,
          exitPrice: bar.close,
          qty: pos.totalQty,
          pnl: Math.round(pnl * 100) / 100,
          pnlPercent: Math.round((pnl / (pos.totalQty * pos.avgPrice)) * 10000) / 100,
          score: pos.score,
          setupType: pos.setupType,
          exitReason: 'DEAD_CAPITAL',
        });
        closedIndices.push(p);
      }
    }
    // Remove closed positions (and fully exited ones)
    openPositions = openPositions.filter((_, idx) => !closedIndices.includes(idx)).filter(p => p.totalQty > 0);

    // Track equity
    peakEquity = Math.max(peakEquity, capital);
    const dd = ((peakEquity - capital) / peakEquity) * 100;
    maxDD = Math.max(maxDD, dd);
    equityCurve.push({ date: bar.date, equity: Math.round(capital * 100) / 100 });

    // Check for new entry (simplified - using previous bar's signal)
    if (barIdx < 2 || barIdx - lastTradeBar <= config.cooldownBars) continue;
    if (openPositions.length >= maxOpenTrades) continue;

    const i = barIdx;
    const i1 = barIdx - 1;
    
    // Quick signal check on previous bar
    const prevSMA200 = sma200Full[i1];
    const prevEMA20 = ema20Full[i1];
    const prevRSI = rsi14Full[i1];
    const prevATR = atr14Full[i1];
    const prevADX = adxFull[i1];
    const prevCandle = candles[i1];

    if (!prevSMA200 || !prevEMA20 || !prevRSI || !prevATR || !prevADX) continue;

    // Simplified confluence check (mirroring the screening logic)
    const prevADX1 = adxFull[i1 - 1] ?? 0;
    const trending = prevADX > 18 || (prevADX > prevADX1 && prevADX > 15);
    const atrSma20 = calcSMA(atr14Full.slice(Math.max(0, i - 20), i).filter(v => v != null), 20);
    const validVol = prevATR > atrSma20 * 0.6 && prevATR < atrSma20 * 1.8;
    const notExt = prevCandle.close < prevEMA20 * 1.06;

    // Nifty check
    let regimeSafe = true;
    if (niftyCandles.length >= 200) {
      const niftyIdx = Math.min(niftyCandles.length - 1, barIdx);
      const nifty200 = nifty200Full[niftyIdx];
      if (nifty200) regimeSafe = niftyCandles[niftyIdx].close > nifty200;
    }

    // Only require 2 of 4 regime filters (instead of all 4)
    const regimePassCount = [trending, validVol, notExt, regimeSafe].filter(Boolean).length;
    if (regimePassCount < 2) continue;

    // Score calculation on prev bar
    let score = 0;
    if (prevCandle.close > prevSMA200 && prevRSI > 52) score++;
    const low4 = Math.min(...lows.slice(Math.max(0, i1 - 4), i1 + 1));
    if (low4 < prevEMA20 * 1.02 && prevCandle.close > prevEMA20) score++;
    if (prevCandle.close > candles[i1 - 1]?.high) score++;
    const vm = calcSMA(volumes.slice(Math.max(0, i1 - 20), i1 + 1), 20);
    if (prevCandle.volume > vm * 1.05) score++;
    
    const gapPct = Math.abs(prevCandle.open - candles[i1 - 1]?.close) / (candles[i1 - 1]?.close || 1) * 100;
    if (gapPct < 3.5) score++;

    // Score 6: Relative Strength (vs Nifty)
    if (niftyCandles.length >= 25) {
      const niftyIdx = Math.min(niftyCandles.length - 1, i1);
      const niftyClose = niftyCandles[niftyIdx]?.close ?? 0;
      if (niftyClose > 0) {
        const rsWindow = Math.min(25, i1 + 1, niftyCandles.length);
        const rsStart = Math.max(0, i1 - rsWindow + 1);
        const niftyStart = Math.max(0, niftyIdx - rsWindow + 1);
        const rsValues: number[] = [];
        for (let j = 0; j < rsWindow; j++) {
          const cj = rsStart + j;
          const nj = niftyStart + j;
          if (closes[cj] && niftyCandles[nj]?.close) {
            rsValues.push(closes[cj] / niftyCandles[nj].close);
          }
        }
        if (rsValues.length > 5) {
          const rsMA = calcSMA(rsValues, 20);
          const currentRS = rsValues[rsValues.length - 1];
          const rs5ago = rsValues[rsValues.length - 6];
          if (currentRS > rsMA || currentRS > rs5ago) score++;
        }
      }
    }

    if (score >= config.minScore) {
      const theoreticalEP = Math.max(bar.open, prevCandle.high);
      const stopLow5 = Math.min(...lows.slice(Math.max(0, i - 5), i));
      const rawSL = stopLow5 - (prevATR * 0.8);
      const riskPerShare = theoreticalEP - rawSL;

      if (riskPerShare <= 0) continue;

      const structRange = Math.max(...highs.slice(Math.max(0, i - 60), i)) - Math.min(...lows.slice(Math.max(0, i - 60), i));
      const rr = structRange / riskPerShare;
      if (rr < config.minRR && score < 6) continue;

      // Size calculation
      const ddPenalty = Math.max(0.25, Math.min(1.0, 1.0 - (maxDD / 20.0)));
      const baseRisk = score === 6 ? riskPct : riskPct * 0.5;
      const appliedRisk = baseRisk * ddPenalty;
      const maxRisk = capital * (appliedRisk / 100);
      
      const qtyRisk = Math.floor(maxRisk / riskPerShare);
      const slotMultiplier = score === 6 ? 1.0 : 0.6;
      const targetAlloc = (capital / maxSlots) * slotMultiplier;
      const qtyCap = Math.floor(targetAlloc / theoreticalEP);
      const qty = Math.max(1, Math.min(qtyRisk, qtyCap));

      const tp1 = theoreticalEP + (riskPerShare * 1.5);

      if (capital < qty * theoreticalEP) continue;

      openPositions.push({
        entryBar: barIdx,
        entryPrice: theoreticalEP,
        qty,
        stopLoss: rawSL,
        tp1,
        score,
        setupType: score === 6 ? 'A+' : 'B',
        partialTaken: false,
        trailActive: false,
        totalQty: qty,
        avgPrice: theoreticalEP,
        blendedSL: rawSL,
      });

      capital -= qty * theoreticalEP;
      lastTradeBar = barIdx;
    }
  }

  // Close remaining open positions at last bar price
  for (const pos of openPositions) {
    const lastPrice = candles[candles.length - 1].close;
    const pnl = pos.totalQty * (lastPrice - pos.avgPrice);
    capital += pnl + pos.totalQty * pos.avgPrice;
    trades.push({
      symbol,
      entryDate: candles[pos.entryBar].date,
      entryPrice: pos.avgPrice,
      exitDate: candles[candles.length - 1].date,
      exitPrice: lastPrice,
      qty: pos.totalQty,
      pnl: Math.round(pnl * 100) / 100,
      pnlPercent: Math.round((pnl / (pos.totalQty * pos.avgPrice)) * 10000) / 100,
      score: pos.score,
      setupType: pos.setupType,
      exitReason: 'BACKTEST_END',
    });
  }

  // Calculate stats
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  // Sharpe ratio (simplified)
  const returns = trades.map(t => t.pnlPercent);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdReturn = returns.length > 1
    ? Math.sqrt(returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1))
    : 1;
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

  return {
    trades,
    equityCurve,
    stats: {
      totalTrades: trades.length,
      winTrades: wins.length,
      lossTrades: losses.length,
      winRate: trades.length > 0 ? Math.round((wins.length / trades.length) * 10000) / 100 : 0,
      profitFactor: grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : 0,
      maxDrawdown: Math.round(maxDD * 100) / 100,
      avgWin: wins.length > 0 ? Math.round((grossProfit / wins.length) * 100) / 100 : 0,
      avgLoss: losses.length > 0 ? Math.round((grossLoss / losses.length) * 100) / 100 : 0,
      bestTrade: trades.length > 0 ? Math.round(Math.max(...trades.map(t => t.pnl)) * 100) / 100 : 0,
      worstTrade: trades.length > 0 ? Math.round(Math.min(...trades.map(t => t.pnl)) * 100) / 100 : 0,
      finalCapital: Math.round(capital * 100) / 100,
      sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    },
  };
}

// ── Utilities ──────────────────────────────────────────────

function padArray(arr: (number | undefined)[], targetLen: number): (number | null)[] {
  const padding = targetLen - arr.length;
  const padded: (number | null)[] = new Array(padding).fill(null);
  return [...padded, ...arr.map(v => v ?? null)];
}

function calcSMA(values: (number | null | undefined)[], period: number): number {
  const valid = values.filter(v => v != null) as number[];
  const slice = valid.slice(-period);
  if (slice.length === 0) return 0;
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

// ── Default NSE Watchlist ──────────────────────────────────

export const DEFAULT_WATCHLIST: { symbol: string; name: string; sector: string }[] = [
  { symbol: 'RELIANCE', name: 'Reliance Industries', sector: 'Energy' },
  { symbol: 'TCS', name: 'Tata Consultancy Services', sector: 'IT' },
  { symbol: 'HDFCBANK', name: 'HDFC Bank', sector: 'Banking' },
  { symbol: 'INFY', name: 'Infosys', sector: 'IT' },
  { symbol: 'ICICIBANK', name: 'ICICI Bank', sector: 'Banking' },
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever', sector: 'FMCG' },
  { symbol: 'SBIN', name: 'State Bank of India', sector: 'Banking' },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel', sector: 'Telecom' },
  { symbol: 'ITC', name: 'ITC Limited', sector: 'FMCG' },
  { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank', sector: 'Banking' },
  { symbol: 'LT', name: 'Larsen & Toubro', sector: 'Infrastructure' },
  { symbol: 'WIPRO', name: 'Wipro', sector: 'IT' },
  { symbol: 'AXISBANK', name: 'Axis Bank', sector: 'Banking' },
  { symbol: 'TATAMOTORS', name: 'Tata Motors', sector: 'Auto' },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance', sector: 'Finance' },
  { symbol: 'MARUTI', name: 'Maruti Suzuki', sector: 'Auto' },
  { symbol: 'SUNPHARMA', name: 'Sun Pharma', sector: 'Pharma' },
  { symbol: 'TATASTEEL', name: 'Tata Steel', sector: 'Metals' },
  { symbol: 'ADANIENT', name: 'Adani Enterprises', sector: 'Conglomerate' },
  { symbol: 'ASIANPAINT', name: 'Asian Paints', sector: 'Consumer' },
  { symbol: 'HCLTECH', name: 'HCL Technologies', sector: 'IT' },
  { symbol: 'BAJAJFINSV', name: 'Bajaj Finserv', sector: 'Finance' },
  { symbol: 'DMART', name: 'Avenue Supermarts', sector: 'Retail' },
  { symbol: 'DIVISLAB', name: 'Divi Laboratories', sector: 'Pharma' },
  { symbol: 'TITAN', name: 'Titan Company', sector: 'Consumer' },
  { symbol: 'POWERGRID', name: 'Power Grid Corp', sector: 'Power' },
  { symbol: 'NTPC', name: 'NTPC Limited', sector: 'Power' },
  { symbol: 'ULTRACEMCO', name: 'UltraTech Cement', sector: 'Cement' },
  { symbol: 'TECHM', name: 'Tech Mahindra', sector: 'IT' },
  { symbol: 'HINDALCO', name: 'Hindalco Industries', sector: 'Metals' },
  { symbol: 'DRREDDY', name: "Dr Reddy's Labs", sector: 'Pharma' },
];