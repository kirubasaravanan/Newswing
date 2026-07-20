/**
 * India VIX (Volatility Index) Integration
 * 
 * VIX is the backbone of Indian options pricing. It represents the market's
 * expectation of 30-day volatility derived from NIFTY option prices.
 * 
 * Key relationships:
 * - Index option IV tracks VIX closely (NIFTY ATM IV ≈ VIX × adjustment)
 * - Stock option IV = VIX + stock-specific premium (beta-adjusted)
 * - VIX spike → all option premiums expand
 * - VIX < 12 → complacency, potential for sudden spike
 * - VIX > 25 → fear, option selling opportunities
 * - VIX > 35 → extreme panic, hedging expensive
 */

// ── VIX Data Types ─────────────────────────────────────────────

export interface VIXData {
  value: number;           // Current VIX level
  change: number;          // Absolute change
  changePct: number;       // Percentage change
  high52w: number;         // 52-week high
  low52w: number;          // 52-week low
  percentile: number;      // Current percentile vs 1yr range (0-100)
  regime: 'low' | 'normal' | 'elevated' | 'high' | 'extreme';
  fetchedAt: number;       // Timestamp
}

export interface VIXHistory {
  date: string;
  close: number;
  change: number;
  changePct: number;
}

// ── VIX Regime Classification ──────────────────────────────────

const VIX_THRESHOLDS = {
  low: 11,       // < 11: Extreme complacency — dangerous for option buyers
  normal: 16,    // 11-16: Normal market conditions
  elevated: 22,  // 16-22: Elevated — higher premiums, wider spreads
  high: 30,      // 22-30: High fear — expensive options
  // > 30: Extreme panic
};

export function classifyVIXRegime(vix: number): VIXData['regime'] {
  if (vix < VIX_THRESHOLDS.low) return 'low';
  if (vix < VIX_THRESHOLDS.normal) return 'normal';
  if (vix < VIX_THRESHOLDS.elevated) return 'elevated';
  if (vix < VIX_THRESHOLDS.high) return 'high';
  return 'extreme';
}

// ── VIX Trading Guidance ───────────────────────────────────────

export interface VIXGuidance {
  regime: VIXData['regime'];
  optionBuyerBias: 'favorable' | 'neutral' | 'unfavorable';
  optionSellerBias: 'favorable' | 'neutral' | 'unfavorable';
  strategyHints: string[];
  ivAdjustment: number;     // Multiplier for base IV estimation
  warningLevel: 'none' | 'caution' | 'warning' | 'danger';
  summary: string;
}

export function getVIXGuidance(vix: number): VIXGuidance {
  const regime = classifyVIXRegime(vix);
  
  switch (regime) {
    case 'low':
      return {
        regime,
        optionBuyerBias: 'unfavorable',
        optionSellerBias: 'favorable',
        strategyHints: [
          'VIX is very low — options are cheap but theta decay will eat premiums fast',
          'Good for: Credit spreads, Iron Condors, Iron Butterflies',
          'Avoid: Naked long options (low premium, high theta)',
          'Risk: Sudden VIX spike can cause losses on short options',
        ],
        ivAdjustment: 0.85,  // IV tends to be understated
        warningLevel: 'caution',
        summary: 'Low volatility environment — favor option selling strategies',
      };
    case 'normal':
      return {
        regime,
        optionBuyerBias: 'neutral',
        optionSellerBias: 'neutral',
        strategyHints: [
          'Normal VIX — balanced conditions for both buyers and sellers',
          'Good for: Directional strategies, Straddles before events',
          'Moderate theta decay — time matters but not extreme',
        ],
        ivAdjustment: 1.0,
        warningLevel: 'none',
        summary: 'Normal volatility — all strategies viable',
      };
    case 'elevated':
      return {
        regime,
        optionBuyerBias: 'favorable',
        optionSellerBias: 'neutral',
        strategyHints: [
          'Elevated VIX — premiums are rich, good for option buyers',
          'Good for: Long straddles, directional bets with defined risk',
          'Caution: Selling options here carries higher risk',
          'Consider: Calendar spreads (sell near-week, buy far-week)',
        ],
        ivAdjustment: 1.15,
        warningLevel: 'caution',
        summary: 'Elevated volatility — premiums are rich, favor buyers',
      };
    case 'high':
      return {
        regime,
        optionBuyerBias: 'favorable',
        optionSellerBias: 'unfavorable',
        strategyHints: [
          'High VIX — very expensive options, selling is risky',
          'Good for: Buying puts for hedging, long straddles',
          'Avoid: Naked option selling, credit spreads',
          'Consider: Ratio spreads, backspreads for volatility plays',
        ],
        ivAdjustment: 1.3,
        warningLevel: 'warning',
        summary: 'High fear environment — options are expensive, be cautious selling',
      };
    case 'extreme':
      return {
        regime,
        optionBuyerBias: 'neutral',
        optionSellerBias: 'unfavorable',
        strategyHints: [
          'EXTREME VIX — market panic, spreads are very wide',
          'Hedging is extremely expensive — consider reducing positions',
          'Only for experienced traders: Sell far OTM puts if you believe bottom is near',
          'Risk: VIX can stay elevated longer than expected',
        ],
        ivAdjustment: 1.5,
        warningLevel: 'danger',
        summary: 'Extreme panic — reduce risk, avoid new positions unless experienced',
      };
  }
}

// ── VIX Spot Fetcher (Yahoo Finance) ──────────────────────────

const VIX_CACHE_TTL = 60_000; // 1 minute (VIX updates every minute during market hours)
let vixCache: VIXData | null = null;

const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Connection': 'close',
};

export async function fetchVIX(): Promise<VIXData> {
  // Return cache if fresh
  if (vixCache && Date.now() - vixCache.fetchedAt < VIX_CACHE_TTL) {
    return vixCache;
  }

  const end = Math.floor(Date.now() / 1000);
  const start = end - 365 * 86400; // 1 year for 52w high/low

  const url = `${YAHOO_CHART_URL}^INDIAVIX?period1=${start}&period2=${end}&interval=1d`;

  const res = await fetch(url, { headers: YAHOO_HEADERS });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} for ^INDIAVIX`);

  const json: any = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('No VIX data from Yahoo');

  const meta = result.meta;
  const currentPrice = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose || currentPrice;

  // Calculate 52-week high/low from timestamps
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  
  let high52w = currentPrice;
  let low52w = currentPrice;
  for (const c of closes) {
    if (c != null) {
      high52w = Math.max(high52w, c);
      low52w = Math.min(low52w, c);
    }
  }

  const change = Math.round((currentPrice - prevClose) * 100) / 100;
  const changePct = prevClose > 0 
    ? Math.round((change / prevClose) * 10000) / 100 
    : 0;
  const range = high52w - low52w;
  const percentile = range > 0 
    ? Math.round(((currentPrice - low52w) / range) * 100) 
    : 50;

  vixCache = {
    value: Math.round(currentPrice * 100) / 100,
    change,
    changePct,
    high52w: Math.round(high52w * 100) / 100,
    low52w: Math.round(low52w * 100) / 100,
    percentile,
    regime: classifyVIXRegime(currentPrice),
    fetchedAt: Date.now(),
  };

  return vixCache;
}

// ── VIX-Based IV Adjustment ────────────────────────────────────

/**
 * Adjust base IV using VIX level.
 * 
 * For index options: IV ≈ VIX × 0.95 (ATM), with skew for OTM/ITM
 * For stock options: IV ≈ VIX × 1.2 + stock_beta_premium
 * 
 * @param vix - Current VIX value
 * @param symbolType - 'index' or 'stock'
 * @param strike - Strike price
 * @param spot - Spot price
 * @param optionType - 'CE' or 'PE'
 * @param daysToExpiry - Days until expiry
 */
export function vixAdjustedIV(
  vix: number,
  symbolType: 'index' | 'stock',
  strike: number,
  spot: number,
  optionType: 'CE' | 'PE',
  daysToExpiry: number
): number {
  // Base IV from VIX
  let baseIV: number;
  
  if (symbolType === 'index') {
    // Index ATM IV closely tracks VIX (slight discount for NIFTY)
    baseIV = vix / 100 * 0.95;
  } else {
    // Stock IV = VIX + idiosyncratic premium (stocks are riskier than index)
    // Typical: NIFTY VIX 13% → Stock IV 22-30%
    baseIV = vix / 100 * 1.2 + 0.08;
  }

  // ── Term Structure Adjustment ──────────────────────────
  // Near-term (weekly) options have higher IV than far-term (monthly)
  // This is the "volatility term structure"
  let termAdjustment = 0;
  if (daysToExpiry <= 7) {
    termAdjustment = 0.02; // Near-week premium (gamma risk)
  } else if (daysToExpiry <= 14) {
    termAdjustment = 0.01;
  } else if (daysToExpiry > 30) {
    termAdjustment = -0.01; // Far-month discount (mean reversion expectation)
  }

  // ── Moneyness Skew ────────────────────────────────────
  const moneyness = (strike - spot) / spot;
  
  // Indian market typically has a put skew (PE IV > CE IV for OTM)
  let skew: number;
  if (optionType === 'PE') {
    // OTM puts have higher IV (fear premium / hedging demand)
    skew = 0.6 * Math.abs(moneyness); // Steeper for indices
    if (symbolType === 'index') skew *= 1.3;
  } else {
    // OTM calls have slightly lower IV
    skew = -0.3 * moneyness;
  }

  // Smile curvature (deep OTM options have higher IV)
  const smile = 0.4 * moneyness * moneyness;

  // ── Expiry Day Gamma Premium ──────────────────────────
  // On expiry day, near-ATM options have inflated IV due to gamma risk
  let expiryDayPremium = 0;
  if (daysToExpiry <= 1) {
    const nearATM = Math.abs(moneyness) < 0.02;
    if (nearATM) {
      expiryDayPremium = 0.03; // Gamma explosion near ATM
    }
  }

  const finalIV = baseIV + termAdjustment + skew + smile + expiryDayPremium;
  
  return Math.max(0.05, Math.min(finalIV, 3.0)); // Clamp 5%-300%
}

// ── VIX Correlation with NIFTY ─────────────────────────────────

/**
 * Estimate expected move for NIFTY based on VIX.
 * Formula: Expected Daily Move = NIFTY × (VIX / √252) × 100
 */
export function expectedDailyMove(niftyPrice: number, vix: number): number {
  const dailyVol = vix / 100 / Math.sqrt(252);
  return Math.round(niftyPrice * dailyVol * 100) / 100;
}

/**
 * Estimate weekly expected range for NIFTY.
 */
export function expectedWeeklyRange(niftyPrice: number, vix: number): { upper: number; lower: number; range: number } {
  const weeklyVol = vix / 100 / Math.sqrt(52);
  const move = niftyPrice * weeklyVol;
  return {
    upper: Math.round((niftyPrice + move) * 100) / 100,
    lower: Math.round((niftyPrice - move) * 100) / 100,
    range: Math.round(move * 2 * 100) / 100,
  };
}