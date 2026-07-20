/**
 * Black-Scholes Options Pricing Engine
 * Implements standard BS model with Greeks, IV solver, and Greeks-based SL/TP.
 * 
 * Supports dividend yield (q) for stock options via Black-Scholes-Merton model:
 *   d1 = [ln(S/K) + (r - q + σ²/2)T] / (σ√T)
 *   d2 = d1 - σ√T
 *   CE = S·e^(-qT)·N(d1) - K·e^(-rT)·N(d2)
 *   PE = K·e^(-rT)·N(-d2) - S·e^(-qT)·N(-d1)
 * 
 * Index options: q = 0 (no dividends, cash-settled)
 * Stock options: q = dividend yield (e.g., ITC ~3%, HINDUNILVR ~1.5%)
 */

// ── Normal Distribution ──────────────────────────────────────

/** Standard normal CDF using rational approximation (Abramowitz & Stegun) */
export function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);

  return 0.5 * (1.0 + sign * y);
}

/** Standard normal PDF */
export function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// ── Black-Scholes Core ───────────────────────────────────────

export interface BlackScholesResult {
  premium: number;
  delta: number;
  gamma: number;
  theta: number;   // per day
  vega: number;    // per 1% change in IV
  iv: number;      // the IV used
}

/**
 * Black-Scholes-Merton option pricing (with dividend yield support)
 * @param S - Spot price
 * @param K - Strike price
 * @param T - Time to expiry in YEARS
 * @param r - Risk-free rate (0.07 for India)
 * @param sigma - Implied volatility as decimal (e.g. 0.15 for 15%)
 * @param type - 'CE' or 'PE'
 * @param q - Dividend yield (0 for index options, ~0.01-0.04 for stocks)
 */
export function blackScholes(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  type: 'CE' | 'PE',
  q: number = 0
): BlackScholesResult {
  // Guard against NaN/Infinity from bad data
  if (!isFinite(S) || !isFinite(K) || !isFinite(sigma) || !isFinite(T) || !isFinite(r)) {
    return { premium: 0, delta: 0, gamma: 0, theta: 0, vega: 0, iv: sigma };
  }
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    // At expiry or invalid: intrinsic value only
    const intrinsic = type === 'CE' ? Math.max(S - K, 0) : Math.max(K - S, 0);
    return { premium: intrinsic, delta: 0, gamma: 0, theta: 0, vega: 0, iv: sigma };
  }

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  const nd1 = normalPDF(d1);
  const Nd1 = normalCDF(d1);
  const Nd2 = normalCDF(d2);
  const Nnd1 = normalCDF(-d1);
  const Nnd2 = normalCDF(-d2);

  const expRT = Math.exp(-r * T);
  const expQT = Math.exp(-q * T); // Dividend yield discount

  let premium: number;
  let delta: number;

  if (type === 'CE') {
    premium = S * expQT * Nd1 - K * expRT * Nd2;
    delta = Math.exp(-q * T) * Nd1; // Delta adjusted for dividends
  } else {
    premium = K * expRT * Nnd2 - S * expQT * Nnd1;
    delta = Math.exp(-q * T) * (Nd1 - 1);
  }

  const gamma = nd1 * Math.exp(-q * T) / (S * sigma * sqrtT);
  // Theta per day (365 days convention for India) — includes dividend yield
  const theta = (
    -S * nd1 * sigma * Math.exp(-q * T) / (2 * sqrtT)
    + q * S * Math.exp(-q * T) * (type === 'CE' ? Nd1 : -Nnd1)
    - r * K * expRT * (type === 'CE' ? Nd2 : -Nnd2)
  ) / 365;
  // Vega per 1% change in IV
  const vega = (S * nd1 * sqrtT) / 100;

  return {
    premium: Math.max(premium, 0),
    delta: Math.round(delta * 10000) / 10000,
    gamma: Math.round(gamma * 100000) / 100000,
    theta: Math.round(theta * 100) / 100,
    vega: Math.round(vega * 100) / 100,
    iv: sigma,
  };
}

// ── Implied Volatility (Newton-Raphson) ──────────────────────

/**
 * Solve for IV given market price using Newton-Raphson.
 */
export interface IVResult {
  iv: number;
  converged: boolean;
  iterations: number;
}

/**
 * Solve for IV given market price using Newton-Raphson.
 * Returns both the IV and whether the solver converged.
 */
export function impliedVolatility(
  S: number,
  K: number,
  T: number,
  r: number,
  marketPrice: number,
  type: 'CE' | 'PE',
  maxIterations: number = 50,
  tolerance: number = 1e-6
): IVResult {
  // Guard against invalid inputs
  if (!isFinite(S) || !isFinite(K) || !isFinite(marketPrice) || S <= 0 || K <= 0 || marketPrice <= 0 || T <= 0) {
    return { iv: 0.15, converged: false, iterations: 0 };
  }

  // If market price is below intrinsic value, IV is effectively infinite
  const intrinsic = type === 'CE' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  if (marketPrice < intrinsic) {
    return { iv: 0.01, converged: false, iterations: 0 };
  }

  // Initial guess
  let sigma = 0.3;

  for (let i = 0; i < maxIterations; i++) {
    const result = blackScholes(S, K, T, r, sigma, type);
    const diff = result.premium - marketPrice;

    // If close enough, return converged
    if (Math.abs(diff) < tolerance) {
      return { iv: sigma, converged: true, iterations: i + 1 };
    }

    // Vega is per 1% — convert to per decimal
    const vegaDecimal = result.vega * 100;

    // Avoid division by zero
    if (vegaDecimal < 1e-10) {
      sigma += 0.01;
      continue;
    }

    // Newton step
    sigma = sigma - diff / vegaDecimal;

    // Keep sigma in reasonable bounds
    sigma = Math.max(0.01, Math.min(sigma, 5.0));
  }

  // Did not converge — return best estimate but flag it
  return { iv: sigma, converged: false, iterations: maxIterations };
}

// ── Greeks-based SL/TP Calculator ────────────────────────────

export interface GreeksSLConfig {
  entryPremium: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  iv: number;
  daysToExpiry: number;
  strike: number;
  spot: number;
  action: 'BUY' | 'SELL';
  lotSize: number;
  qty: number;
  underlyingSymbol: string;
  optionType: 'CE' | 'PE';
}

export interface GreeksSLResult {
  stopLoss: number;
  takeProfit: number;
  slReasoning: string;
  tpReasoning: string;
  thetaDecayPerDay: number;
  gammaRisk: number;
  maxLoss: number;
  maxProfit: number;
  breakeven: number;
  riskReward: number;
  marginEstimate: number;
  daysToExpiry: number;
}

/**
 * Calculate Greeks-based SL and TP levels.
 * For BUY options: avoids theta/gamma hitting SL prematurely.
 * For SELL options: caps loss, lets theta work.
 */
export function calculateGreeksSL(config: GreeksSLConfig): GreeksSLResult {
  const {
    entryPremium, delta, gamma, theta, vega, iv,
    daysToExpiry, strike, spot, action, lotSize, qty,
    underlyingSymbol, optionType,
  } = config;

  const totalShares = lotSize * qty;
  const isBuy = action === 'BUY';

  // ── SL Logic ───────────────────────────────────────
  let stopLoss: number;
  let slReasoning: string;

  if (isBuy) {
    const thetaDecayBuffer = Math.abs(theta) * 1.5 * Math.min(daysToExpiry, 5);
    const adverseMove = 0.02 * spot;
    const gammaBuffer = 0.5 * Math.abs(gamma) * adverseMove * adverseMove;
    const buffer = Math.max(thetaDecayBuffer, gammaBuffer) * 1.2;
    stopLoss = Math.max(entryPremium - buffer, entryPremium * 0.3);

    if (thetaDecayBuffer > gammaBuffer) {
      slReasoning = `SL at ₹${stopLoss.toFixed(2)} (buffer: ₹${buffer.toFixed(2)}). Theta decay over ${Math.min(daysToExpiry, 5)}d ≈ ₹${thetaDecayBuffer.toFixed(2)} dominates. Max 70% premium risk.`;
    } else {
      slReasoning = `SL at ₹${stopLoss.toFixed(2)} (buffer: ₹${buffer.toFixed(2)}). Gamma risk from 2% spot move ≈ ₹${gammaBuffer.toFixed(2)} dominates. Max 70% premium risk.`;
    }
  } else {
    // SELL: cap loss at ~50% of premium, plus theta buffer
    const thetaBuffer = Math.abs(theta) * 2 * Math.min(daysToExpiry, 5);
    stopLoss = entryPremium * 1.5 + thetaBuffer;
    stopLoss = Math.min(stopLoss, entryPremium * 3); // hard cap at 3x

    slReasoning = `SL at ₹${stopLoss.toFixed(2)} for sold option. 50% premium buffer + theta decay risk over ${Math.min(daysToExpiry, 5)}d ≈ ₹${thetaBuffer.toFixed(2)}.`;
  }

  // ── TP Logic ───────────────────────────────────────
  let takeProfit: number;
  let tpReasoning: string;

  if (isBuy) {
    const expectedUnderlyingMove = 0.02 * spot * Math.min(daysToExpiry, 10) / 10;
    const deltaMove = Math.abs(delta) * expectedUnderlyingMove;
    takeProfit = entryPremium + deltaMove;
    takeProfit = Math.min(takeProfit, entryPremium * 3); // cap at 300%

    tpReasoning = `TP at ₹${takeProfit.toFixed(2)} (₹${deltaMove.toFixed(2)} from delta × expected ${Math.min(daysToExpiry, 10)}d move). Capped at 3× entry.`;
  } else {
    takeProfit = entryPremium * 0.5; // book 50% of premium

    tpReasoning = `TP at ₹${takeProfit.toFixed(2)} (book 50% of premium received). Let theta decay do the work.`;
  }

  // ── Breakeven ──────────────────────────────────────
  let breakeven: number;
  if (optionType === 'CE') {
    breakeven = strike + entryPremium;
  } else {
    breakeven = strike - entryPremium;
  }

  // ── Max Loss / Max Profit ──────────────────────────
  let maxLoss: number;
  let maxProfit: number;

  if (isBuy) {
    maxLoss = (entryPremium - stopLoss) * totalShares;
    maxProfit = (takeProfit - entryPremium) * totalShares;
  } else {
    maxLoss = (stopLoss - entryPremium) * totalShares;
    maxProfit = (entryPremium - takeProfit) * totalShares;
  }

  const riskReward = maxLoss > 0 ? Math.abs(maxProfit / maxLoss) : 0;

  // ── Margin Estimate ────────────────────────────────
  // Simplified margin: for BUY = premium × totalShares, for SELL = premium × totalShares × 3 (SPAN + exposure)
  let marginEstimate: number;
  if (isBuy) {
    marginEstimate = entryPremium * totalShares;
  } else {
    marginEstimate = entryPremium * totalShares * 3;
  }

  return {
    stopLoss: Math.round(stopLoss * 100) / 100,
    takeProfit: Math.round(takeProfit * 100) / 100,
    slReasoning,
    tpReasoning,
    thetaDecayPerDay: Math.round(Math.abs(theta) * 100) / 100,
    gammaRisk: Math.round(0.5 * Math.abs(gamma) * Math.pow(0.02 * spot, 2) * 100) / 100,
    maxLoss: Math.round(Math.abs(maxLoss) * 100) / 100,
    maxProfit: Math.round(maxProfit * 100) / 100,
    breakeven: Math.round(breakeven * 100) / 100,
    riskReward: Math.round(riskReward * 100) / 100,
    marginEstimate: Math.round(marginEstimate * 100) / 100,
    daysToExpiry,
  };
}

// ── Lot Size Mapping ─────────────────────────────────────────

// ── Dividend Yield Estimates (Annual) ───────────────────────
// Approximate dividend yields for major F&O stocks.
// In production, fetch from exchange or financial data API.

const DIVIDEND_YIELDS: Record<string, number> = {
  // Indices have no dividends (cash-settled)
  NIFTY: 0,
  BANKNIFTY: 0,
  FINNIFTY: 0,
  NIFTYIT: 0,
  MIDCPNIFTY: 0,
  // High dividend yield stocks
  ITC: 0.032,
  HINDUNILVR: 0.015,
  COALINDIA: 0.045,
  BPCL: 0.028,
  HPCL: 0.035,
  IOC: 0.040,
  NTPC: 0.030,
  POWERGRID: 0.035,
  // Moderate dividend yield
  RELIANCE: 0.004,
  TCS: 0.012,
  INFY: 0.023,
  HDFCBANK: 0.011,
  ICICIBANK: 0.008,
  SBIN: 0.010,
  AXISBANK: 0.005,
  KOTAKBANK: 0.001,
  BAJFINANCE: 0.003,
  LT: 0.015,
  BHARTIARTL: 0.003,
  MARUTI: 0.005,
  TATAMOTORS: 0.001,
  SUNPHARMA: 0.003,
  WIPRO: 0.003,
  ASIANPAINT: 0.008,
  HCLTECH: 0.040,
  ADANIENT: 0,
  TATASTEEL: 0.020,
};

export function getDividendYield(symbol: string): number {
  return DIVIDEND_YIELDS[symbol] ?? 0.01; // Default 1% for unknown stocks
}

// ── Symbol Classification ─────────────────────────────────────

export const INDEX_SYMBOLS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'NIFTYIT', 'MIDCPNIFTY'] as const;
export type IndexSymbol = typeof INDEX_SYMBOLS[number];

export function isIndexSymbol(symbol: string): boolean {
  return INDEX_SYMBOLS.includes(symbol as IndexSymbol);
}

export function getSymbolType(symbol: string): 'index' | 'stock' {
  return isIndexSymbol(symbol) ? 'index' : 'stock';
}

// ── Lot Size Mapping ─────────────────────────────────────────

const LOT_SIZES: Record<string, number> = {
  NIFTY: 25,
  BANKNIFTY: 15,
  FINNIFTY: 25,
  NIFTYIT: 25,
  MIDCPNIFTY: 50,
  RELIANCE: 250,
  TCS: 175,
  INFY: 300,
  HDFCBANK: 550,
  ICICIBANK: 700,
  SBIN: 1500,
  AXISBANK: 900,
  KOTAKBANK: 800,
  BAJFINANCE: 250,
  ITC: 3200,
  HINDUNILVR: 300,
  LT: 150,
  BHARTIARTL: 475,
  MARUTI: 100,
  TATAMOTORS: 550,
  SUNPHARMA: 1250,
  WIPRO: 1500,
  ASIANPAINT: 200,
  HCLTECH: 1700,
  ADANIENT: 2500,
  TATASTEEL: 475,
};

export function getOptionLotSize(symbol: string): number {
  return LOT_SIZES[symbol] ?? 100; // Default lot size for unknown F&O stocks
}

// ── Settlement Type ───────────────────────────────────────────
// All Indian options are European-style (exercise only at expiry)
// Index options: Cash-settled
// Stock options: Physical settlement (delivery of shares)

export function getSettlementType(symbol: string): 'cash' | 'physical' {
  return isIndexSymbol(symbol) ? 'cash' : 'physical';
}

// ── Time to Expiry Helper ────────────────────────────────────

export function timeToExpiryYears(expiryDate: string): number {
  const now = new Date();
  const expiry = new Date(expiryDate + 'T15:30:00+05:30'); // Indian market close
  const diffMs = expiry.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return Math.max(diffDays / 365, 0);
}

export function daysToExpiry(expiryDate: string): number {
  const now = new Date();
  const expiry = new Date(expiryDate + 'T15:30:00+05:30');
  const diffMs = expiry.getTime() - now.getTime();
  return Math.max(Math.ceil(diffMs / (1000 * 60 * 60 * 24)), 0);
}