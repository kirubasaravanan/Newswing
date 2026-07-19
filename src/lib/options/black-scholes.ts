/**
 * Black-Scholes Options Pricing Engine
 * Implements standard BS model with Greeks, IV solver, and Greeks-based SL/TP.
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
 * Black-Scholes option pricing
 * @param S - Spot price
 * @param K - Strike price
 * @param T - Time to expiry in YEARS
 * @param r - Risk-free rate (0.07 for India)
 * @param sigma - Implied volatility as decimal (e.g. 0.15 for 15%)
 * @param type - 'CE' or 'PE'
 */
export function blackScholes(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  type: 'CE' | 'PE'
): BlackScholesResult {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    // At expiry or invalid: intrinsic value only
    const intrinsic = type === 'CE' ? Math.max(S - K, 0) : Math.max(K - S, 0);
    return { premium: intrinsic, delta: 0, gamma: 0, theta: 0, vega: 0, iv: sigma };
  }

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  const nd1 = normalPDF(d1);
  const Nd1 = normalCDF(d1);
  const Nd2 = normalCDF(d2);
  const Nnd1 = normalCDF(-d1);
  const Nnd2 = normalCDF(-d2);

  const expRT = Math.exp(-r * T);

  let premium: number;
  let delta: number;

  if (type === 'CE') {
    premium = S * Nd1 - K * expRT * Nd2;
    delta = Nd1;
  } else {
    premium = K * expRT * Nnd2 - S * Nnd1;
    delta = Nd1 - 1;
  }

  const gamma = nd1 / (S * sigma * sqrtT);
  // Theta per day (365 days convention for India)
  const theta = (-S * nd1 * sigma / (2 * sqrtT) - r * K * expRT * (type === 'CE' ? Nd2 : -Nnd2)) / 365;
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
export function impliedVolatility(
  S: number,
  K: number,
  T: number,
  r: number,
  marketPrice: number,
  type: 'CE' | 'PE',
  maxIterations: number = 50,
  tolerance: number = 1e-6
): number {
  // Initial guess: use a simple approximation
  let sigma = 0.3; // 30% starting guess

  for (let i = 0; i < maxIterations; i++) {
    const result = blackScholes(S, K, T, r, sigma, type);
    const diff = result.premium - marketPrice;

    // If close enough, return
    if (Math.abs(diff) < tolerance) {
      return sigma;
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

  return sigma;
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

const LOT_SIZES: Record<string, number> = {
  NIFTY: 25,
  BANKNIFTY: 15,
  FINNIFTY: 25,
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
  return LOT_SIZES[symbol] ?? 100;
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