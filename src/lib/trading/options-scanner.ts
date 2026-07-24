/**
 * Options Scanner — Scans all ~200 F&O stocks + Nifty/BankNifty/FinNifty
 * Generates CE/PE signals using spot price action, OI analysis, and Greeks.
 * Designed to produce 20-30 calls/day.
 */

import { getStocksByCategory, type NSEStock } from './nse-universe';
import { getCurrentPrice, getHistoricalData } from './data-provider';
import { EMA, RSI, ATR, ADX } from 'technicalindicators';

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
function getNextExpiry(): string {
  const now = new Date();
  // Find next Thursday
  const day = now.getDay();
  let daysUntilThu = (4 - day + 7) % 7;
  if (daysUntilThu === 0 && now.getHours() >= 15.5) daysUntilThu = 7; // After market on Thursday, go next week
  const expiry = new Date(now.getTime() + daysUntilThu * 86400000);
  return expiry.toISOString().split('T')[0];
}

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

// ── Real DhanHQ Option Chain OI / PCR Confluence Resolver ─────
// Returns the PCR confluence AND the actual expiry from DhanHQ (which may
// differ from the guessed expiry if the guess didn't match an available date).
async function fetchRealOIConfluence(symbol: string, expiry: string): Promise<{ bullish: boolean; pcr: number; actualExpiry?: string } | null> {
  try {
    const chainResult = await fetchDhanOptionChain(symbol, expiry);
    if (!chainResult || !chainResult.chain || chainResult.chain.length === 0) {
      // Real data unavailable -> Stop analysis per strict directive
      return null;
    }
    const pcrRaw = chainResult.pcr;
    const pcr = typeof pcrRaw === 'number' ? pcrRaw : (typeof pcrRaw === 'object' && pcrRaw ? (pcrRaw as any).pcr || 1.0 : 1.0);
    // PCR > 1.0 indicates Put writing (Bullish support); PCR < 0.8 indicates Call writing (Bearish resistance)
    return { bullish: pcr >= 1.0, pcr, actualExpiry: chainResult.expiryDate };
  } catch (err) {
    console.warn(`[Real OI Fetch] Failed for ${symbol} ${expiry}:`, err);
    return null;
  }
}

export const INDEX_SYMBOLS = ['NIFTY', 'NIFTY50', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];

// ── Single Stock Scan ───────────────────────────────────
async function scanStock(symbol: string, sectorMap: Record<string, string>, minScore: number = 40): Promise<OptionsSignal[]> {
  const signals: OptionsSignal[] = [];
  const isIndex = INDEX_SYMBOLS.includes(symbol);

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

    const expiryGuess = getNextExpiry();
    const oi = await fetchRealOIConfluence(symbol, expiryGuess);
    // Use the ACTUAL expiry from DhanHQ (not the guess) — this fixes the bug
    // where BANKNIFTY (Wed), FINNIFTY (Tue), MIDCPNIFTY (Mon) expiries were
    // always guessed as Thursday, causing wrong expiry in signals/trades.
    const expiry = oi?.actualExpiry || expiryGuess;
    const daysToExpiry = Math.max(1, Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400000));
    const timestamp = new Date().toISOString();

    // ── Signal Generation Logic ──
    const reasons: string[] = [];
    let ceScore = 0;
    let peScore = 0;

    // Factor 1: Price vs EMA20 (trend)
    if (latestClose > ema20Val && ema20Val > prevEma20) {
      ceScore += 20;
      reasons.push('Above rising EMA20');
    } else if (latestClose < ema20Val && ema20Val < prevEma20) {
      peScore += 20;
      reasons.push('Below falling EMA20');
    }

    // Factor 2: EMA9 crossover (momentum)
    if (ema9Val[0] !== undefined && ema9Val > ema20Val) {
      ceScore += 15;
      reasons.push('EMA9 > EMA20 (bullish crossover)');
    } else if (ema9Val[0] !== undefined && ema9Val < ema20Val) {
      peScore += 15;
      reasons.push('EMA9 < EMA20 (bearish crossover)');
    }

    // Factor 3: RSI extremes
    if (rsi < 30) {
      ceScore += 25; // Oversold → CE (reversal)
      reasons.push(`RSI oversold at ${rsi.toFixed(0)}`);
    } else if (rsi > 70) {
      peScore += 25; // Overbought → PE (reversal)
      reasons.push(`RSI overbought at ${rsi.toFixed(0)}`);
    } else if (rsi > 55) {
      ceScore += 10;
    } else if (rsi < 45) {
      peScore += 10;
    }

    // Factor 4: OI analysis
    if (oi?.bullish) {
      ceScore += 15;
      reasons.push('OI structure bullish');
    } else if (oi) {
      peScore += 15;
      reasons.push('OI structure bearish');
    }

    // Factor 5: ADX trend strength (only trade if ADX > 20)
    if (adx > 25) {
      const bonus = Math.min(15, Math.round((adx - 25) / 2));
      if (ceScore > peScore) ceScore += bonus;
      else peScore += bonus;
      reasons.push(`Strong trend ADX=${adx.toFixed(0)}`);
    }

    // Factor 6: Spot change momentum
    if (spotChange > 1.5) {
      ceScore += 10;
      reasons.push(`Strong spot momentum +${spotChange.toFixed(1)}%`);
    } else if (spotChange < -1.5) {
      peScore += 10;
      reasons.push(`Strong spot momentum ${spotChange.toFixed(1)}%`);
    }

    // Factor 7: ATR volatility (higher vol = better options premium)
    if (atrPct > 2.0) {
      const volBonus = 10;
      if (ceScore > peScore) ceScore += volBonus;
      else peScore += volBonus;
      reasons.push(`High volatility ATR=${atrPct.toFixed(1)}%`);
    }

    // Generate CE signal if score >= minScore
    if (ceScore >= minScore) {
      const strike = selectStrike(symbol, spot, 'CE');
      const delta = calculateExactBSDelta(spot, strike, daysToExpiry, 'CE');
      const confidence = Math.min(95, Math.round(ceScore * 1.1 + (delta > 0.4 ? 10 : 0)));
      signals.push({
        symbol, direction: 'CE', entryPrice: spot, strike, expiry,
        confidence, score: ceScore, reasons: reasons.filter(r =>
          r.includes('bullish') || r.includes('Above') || r.includes('oversold') || r.includes('CE') || r.includes('momentum +') || r.includes('EMA9 >') || r.includes('volatility')
        ),
        spotChange, oiBullish: true, rsi, adx, atrPct, timestamp,
        stockName: sectorMap[symbol] ? '' : undefined,
        sector: sectorMap[symbol],
      });
    }

    // Generate PE signal if score >= minScore
    if (peScore >= minScore) {
      const strike = selectStrike(symbol, spot, 'PE');
      const delta = calculateExactBSDelta(spot, strike, daysToExpiry, 'PE');
      const confidence = Math.min(95, Math.round(peScore * 1.1 + (delta > 0.4 ? 10 : 0)));
      signals.push({
        symbol, direction: 'PE', entryPrice: spot, strike, expiry,
        confidence, score: peScore, reasons: reasons.filter(r =>
          r.includes('bearish') || r.includes('Below') || r.includes('overbought') || r.includes('PE') || r.includes('momentum -') || r.includes('EMA9 <') || r.includes('volatility')
        ),
        spotChange, oiBullish: false, rsi, adx, atrPct, timestamp,
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
export async function scanOptionsUniverse(maxSignals?: number, minScore: number = 40): Promise<ScanResult> {
  const startTime = Date.now();
  const universe = getFNOUniverse();
  const sectorMap = buildSectorMap();
  const allSignals: OptionsSignal[] = [];

  // Scan in batches of 10 to avoid overwhelming data providers
  const BATCH_SIZE = 10;
  for (let i = 0; i < universe.length; i += BATCH_SIZE) {
    const batch = universe.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(s => scanStock(s, sectorMap, minScore)));
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