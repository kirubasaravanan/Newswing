/**
 * Option Chain Fetcher
 * Uses Yahoo Finance for spot price, generates theoretical option chain via Black-Scholes.
 */

import { blackScholes, impliedVolatility, getOptionLotSize, timeToExpiryYears, daysToExpiry as dte } from './black-scholes';

// ── Symbol → Yahoo Ticker Mapping ────────────────────────────

const INDEX_SYMBOLS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY'];

const YAHOO_MAP: Record<string, string> = {
  NIFTY: '^NSEI',
  BANKNIFTY: '^NSEBANK',
  FINNIFTY: '^CNXFINANCE',
};

function toYahoo(symbol: string): string {
  if (YAHOO_MAP[symbol]) return YAHOO_MAP[symbol];
  if (symbol.endsWith('.NS')) return symbol;
  return `${symbol}.NS`;
}

// ── Spot Price Fetcher (Yahoo Finance) ───────────────────────

const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Connection': 'close',
};

const spotCache = new Map<string, { price: number; change: number; changePct: number; fetchedAt: number }>();
const SPOT_CACHE_TTL = 30_000; // 30 seconds

async function fetchSpot(symbol: string): Promise<{ price: number; change: number; changePct: number }> {
  const cached = spotCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < SPOT_CACHE_TTL) {
    return { price: cached.price, change: cached.change, changePct: cached.changePct };
  }

  const yahooSym = toYahoo(symbol);
  const end = Math.floor(Date.now() / 1000);
  const start = end - 5 * 86400;
  const url = `${YAHOO_CHART_URL}${encodeURIComponent(yahooSym)}?period1=${start}&period2=${end}&interval=1d`;

  const res = await fetch(url, { headers: YAHOO_HEADERS });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} for ${yahooSym}`);

  const json: any = await res.json();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) throw new Error(`No price data for ${yahooSym}`);

  const price = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose || price;
  const change = price - prevClose;
  const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

  spotCache.set(symbol, {
    price: Math.round(price * 100) / 100,
    change: Math.round(change * 100) / 100,
    changePct: Math.round(changePct * 100) / 100,
    fetchedAt: Date.now(),
  });

  return { price: Math.round(price * 100) / 100, change: Math.round(change * 100) / 100, changePct: Math.round(changePct * 100) / 100 };
}

// ── Strike Generation ────────────────────────────────────────

function getStrikeStep(symbol: string, spot: number): number {
  if (symbol === 'NIFTY') return 50;
  if (symbol === 'BANKNIFTY') return 100;
  if (symbol === 'FINNIFTY') return 50;
  // Stocks: adaptive step
  if (spot > 3000) return 50;
  if (spot > 1000) return 20;
  if (spot > 500) return 10;
  if (spot > 200) return 5;
  return 2.5;
}

function getStrikeRange(symbol: string): { below: number; above: number } {
  if (symbol === 'NIFTY') return { below: 2000, above: 2000 };
  if (symbol === 'BANKNIFTY') return { below: 2000, above: 2000 };
  if (symbol === 'FINNIFTY') return { below: 1500, above: 1500 };
  // Stocks
  return { below: 20, above: 20 };
}

export function generateStrikes(underlyingPrice: number, symbol: string): number[] {
  const step = getStrikeStep(symbol, underlyingPrice);
  const { below, above } = getStrikeRange(symbol);

  const strikes: number[] = [];
  const atmStrike = Math.round(underlyingPrice / step) * step;

  for (let s = atmStrike - below; s <= atmStrike + above; s += step) {
    if (s > 0) strikes.push(s);
  }

  return strikes;
}

// ── IV Estimation (Simplified Volatility Smile) ───────────────

function estimateIV(strike: number, spot: number, type: 'CE' | 'PE', symbol: string): number {
  const isIndex = INDEX_SYMBOLS.includes(symbol);
  const baseIV = isIndex ? 0.13 : 0.25;

  const moneyness = (strike - spot) / spot; // positive for OTM calls

  // Volatility smile: OTM puts and ITM calls have higher IV
  // CE: IV decreases as strike goes up (for OTM calls)
  // PE: IV increases as strike goes down (for OTM puts)
  let skew: number;
  if (type === 'CE') {
    skew = -0.8; // IV drops for higher strikes
  } else {
    skew = 0.8; // IV rises for lower strikes
  }

  // Add smile curvature
  const smile = 0.3 * moneyness * moneyness; // quadratic term for deep OTM

  const iv = baseIV + skew * moneyness + smile;

  // Clamp to reasonable bounds
  return Math.max(0.05, Math.min(iv, 2.0));
}

// ── Expiry Dates ─────────────────────────────────────────────

/**
 * Get next N expiry dates.
 * Indices: weekly expiries on Thursdays.
 * Stocks: monthly expiries on last Thursday.
 */
export function getNextExpiries(symbol: string, count: number = 6): string[] {
  const isIndex = INDEX_SYMBOLS.includes(symbol);
  const expiries: string[] = [];

  const now = new Date();
  // Convert to IST
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);

  for (let i = 0; i < 365 && expiries.length < count; i++) {
    const d = new Date(istNow);
    d.setDate(d.getDate() + i);

    if (isIndex) {
      // Weekly: every Thursday
      if (d.getDay() === 4) {
        const dateStr = formatDate(d);
        if (!expiries.includes(dateStr)) expiries.push(dateStr);
      }
    } else {
      // Monthly: last Thursday of each month
      if (isLastThursday(d)) {
        const dateStr = formatDate(d);
        if (!expiries.includes(dateStr)) expiries.push(dateStr);
      }
    }
  }

  return expiries;
}

function isLastThursday(d: Date): boolean {
  if (d.getDay() !== 4) return false;
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return d.getDate() > lastDay.getDate() - 7;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Option Chain Types ───────────────────────────────────────

interface OptionLegData {
  ltp: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  oi: number;
  volume: number;
  bid: number;
  ask: number;
  itm: boolean;
}

export interface OptionChainRow {
  strike: number;
  ce: OptionLegData;
  pe: OptionLegData;
  distance: number;
  moneyness: 'ITM' | 'ATM' | 'OTM';
}

export interface OptionChainResult {
  symbol: string;
  underlyingPrice: number;
  change: number;
  changePct: number;
  expiryDate: string;
  expiryDates: string[];
  chain: OptionChainRow[];
}

// ── Main: Fetch Option Chain ─────────────────────────────────

export async function fetchOptionChain(
  symbol: string,
  expiryDate: string
): Promise<OptionChainResult> {
  // 1. Get spot price
  const spotData = await fetchSpot(symbol);
  const spot = spotData.price;

  // 2. Get expiry dates
  const expiryDates = getNextExpiries(symbol, 8);
  const targetExpiry = expiryDate || expiryDates[0];

  // 3. Time to expiry
  const T = timeToExpiryYears(targetExpiry);
  const r = 0.07; // India risk-free rate

  // 4. Generate strikes
  const strikes = generateStrikes(spot, symbol);
  const lotSize = getOptionLotSize(symbol);

  // 5. ATM strike
  const step = getStrikeStep(symbol, spot);
  const atmStrike = Math.round(spot / step) * step;

  // 6. Build chain
  const chain: OptionChainRow[] = strikes.map((strike) => {
    const dist = ((strike - spot) / spot) * 100;
    const isATM = Math.abs(strike - atmStrike) < step / 2;

    let moneyness: 'ITM' | 'ATM' | 'OTM';
    if (isATM) {
      moneyness = 'ATM';
    } else if (strike < spot) {
      moneyness = 'ITM'; // CE is ITM when strike < spot
    } else {
      moneyness = 'OTM';
    }

    const ceIV = estimateIV(strike, spot, 'CE', symbol);
    const peIV = estimateIV(strike, spot, 'PE', symbol);

    const ceBS = blackScholes(spot, strike, T, r, ceIV, 'CE');
    const peBS = blackScholes(spot, strike, T, r, peIV, 'PE');

    // Simulated bid/ask spread (wider for OTM)
    const ceSpread = ceBS.premium > 0 ? Math.max(ceBS.premium * 0.02, 0.05) : 0;
    const peSpread = peBS.premium > 0 ? Math.max(peBS.premium * 0.02, 0.05) : 0;

    // Simulated OI (higher near ATM)
    const atmDist = Math.abs(strike - atmStrike);
    const oiBase = Math.max(0, 100000 - atmDist * 50);

    return {
      strike,
      distance: Math.round(dist * 100) / 100,
      moneyness,
      ce: {
        ltp: Math.round(ceBS.premium * 100) / 100,
        iv: Math.round(ceIV * 10000) / 100, // as %
        delta: ceBS.delta,
        gamma: ceBS.gamma,
        theta: ceBS.theta,
        vega: ceBS.vega,
        oi: Math.round(oiBase * (0.8 + Math.random() * 0.4)),
        volume: Math.round(oiBase * (0.1 + Math.random() * 0.3)),
        bid: Math.round((ceBS.premium - ceSpread) * 100) / 100,
        ask: Math.round((ceBS.premium + ceSpread) * 100) / 100,
        itm: strike < spot,
      },
      pe: {
        ltp: Math.round(peBS.premium * 100) / 100,
        iv: Math.round(peIV * 10000) / 100,
        delta: peBS.delta,
        gamma: peBS.gamma,
        theta: peBS.theta,
        vega: peBS.vega,
        oi: Math.round(oiBase * (0.8 + Math.random() * 0.4)),
        volume: Math.round(oiBase * (0.1 + Math.random() * 0.3)),
        bid: Math.round((peBS.premium - peSpread) * 100) / 100,
        ask: Math.round((peBS.premium + peSpread) * 100) / 100,
        itm: strike > spot,
      },
    };
  });

  return {
    symbol,
    underlyingPrice: spot,
    change: spotData.change,
    changePct: spotData.changePct,
    expiryDate: targetExpiry,
    expiryDates,
    chain,
  };
}

// ── Expose spot fetcher for positions API ────────────────────

export async function fetchSpotPrice(symbol: string): Promise<number> {
  const data = await fetchSpot(symbol);
  return data.price;
}