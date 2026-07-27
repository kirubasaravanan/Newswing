/**
 * Option Chain Generator (V2 — VIX-Aware)
 * 
 * Key improvements over V1:
 * - VIX-based IV estimation (not flat hardcoded values)
 * - IV term structure (near-week > far-week for indices)
 * - Dividend yield support via BSM model for stocks
 * - Proper index/stock differentiation (NIFTY, BANKNIFTY, FINNIFTY, NIFTYIT, MIDCPNIFTY)
 * - Stock weekly options support (50+ F&O stocks now have weekly expiries)
 * - Expiry classification (near-week, mid-week, far-week, monthly)
 * - Settlement type awareness (cash vs physical)
 * - PCR and max pain calculations
 * - Bid/ask spread based on liquidity tier
 */

import {
  blackScholes,
  getOptionLotSize,
  getDividendYield,
  getSymbolType,
  getSettlementType,
  timeToExpiryYears,
  daysToExpiry as dte,
  INDEX_SYMBOLS,
} from './black-scholes';
import { fetchVIX, vixAdjustedIV, type VIXData, getVIXGuidance } from './vix';
import {
  fetchNSEOptionChain,
  getExpiryDates as getNSEExpiryDates,
  filterByExpiry,
  findNearestExpiry,
  type NSEOptionData,
} from '@/lib/nse-data';

// ── Symbol → Yahoo Ticker Mapping ────────────────────────────

const YAHOO_MAP: Record<string, string> = {
  NIFTY: '^NSEI',
  BANKNIFTY: '^NSEBANK',
  FINNIFTY: '^CNXFINANCE',
  NIFTYIT: '^CNXIT',
  MIDCPNIFTY: '^CRSMIDCP', // or ^NSEMDCP50
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

  return {
    price: Math.round(price * 100) / 100,
    change: Math.round(change * 100) / 100,
    changePct: Math.round(changePct * 100) / 100,
  };
}

// ── Strike Generation ────────────────────────────────────────

function getStrikeStep(symbol: string, spot: number): number {
  // Index-specific steps
  if (symbol === 'NIFTY') return 50;
  if (symbol === 'BANKNIFTY') return 100;
  if (symbol === 'FINNIFTY') return 50;
  if (symbol === 'NIFTYIT') return 50;
  if (symbol === 'MIDCPNIFTY') return 25;

  // Stocks: adaptive step based on price
  if (spot > 3000) return 50;
  if (spot > 1000) return 20;
  if (spot > 500) return 10;
  if (spot > 200) return 5;
  if (spot > 100) return 2.5;
  return 1;
}

function getStrikeRange(symbol: string): { below: number; above: number } {
  if (symbol === 'NIFTY') return { below: 2500, above: 2500 };
  if (symbol === 'BANKNIFTY') return { below: 3000, above: 3000 };
  if (symbol === 'FINNIFTY') return { below: 1500, above: 1500 };
  if (symbol === 'NIFTYIT') return { below: 1000, above: 1000 };
  if (symbol === 'MIDCPNIFTY') return { below: 800, above: 800 };
  // Stocks: show ±15% range (enough for most strategies)
  return { below: 25, above: 25 };
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

// ── Expiry Classification ────────────────────────────────────

export type ExpiryType = 'near_week' | 'mid_week' | 'far_week' | 'monthly' | 'far_monthly';

export interface ExpiryInfo {
  date: string;
  label: string;
  type: ExpiryType;
  daysToExpiry: number;
  isIndex: boolean;
  isWeekly: boolean;
  isCurrentMonth: boolean;
}

/**
 * Classify an expiry by its distance and type.
 * Near-week: 0-7 days (highest IV, gamma risk)
 * Mid-week: 8-21 days (moderate IV)
 * Far-week: 22-35 days (lower IV)
 * Monthly: >35 days (lowest IV, most liquid for stocks)
 */
export function classifyExpiry(expiryDate: string, symbol: string): ExpiryInfo {
  const days = dte(expiryDate);
  const isIndex = (INDEX_SYMBOLS as readonly string[]).includes(symbol);

  // Determine if it's current month
  const now = new Date();
  const expiry = new Date(expiryDate);
  const isCurrentMonth = now.getMonth() === expiry.getMonth() && now.getFullYear() === expiry.getFullYear();

  let type: ExpiryType;
  if (days <= 7) {
    type = 'near_week';
  } else if (days <= 21) {
    type = isIndex ? 'mid_week' : 'far_week'; // Stocks with 2-3 week expiry = far
  } else if (days <= 35) {
    type = isIndex ? 'far_week' : 'monthly';
  } else {
    type = isCurrentMonth ? 'monthly' : 'far_monthly';
  }

  // Generate human-readable label
  const d = new Date(expiryDate);
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  let label: string;
  if (days <= 7) {
    label = `${dayNames[d.getDay()]} (${days}d)`;
  } else if (isIndex) {
    label = `${d.getDate()} ${monthNames[d.getMonth()]} (${days}d)`;
  } else {
    // Monthly: show month name
    label = `${monthNames[d.getMonth()]} ${d.getDate()} (${days}d)`;
  }

  return {
    date: expiryDate,
    label,
    type,
    daysToExpiry: days,
    isIndex,
    isWeekly: isIndex || days <= 21,
    isCurrentMonth,
  };
}

// ── Expiry Dates ─────────────────────────────────────────────

// Individual stock options on NSE India only have monthly expiries (last Thursday of month)
function hasWeeklyOptions(symbol: string): boolean {
  return (INDEX_SYMBOLS as readonly string[]).includes(symbol);
}

/**
 * Get next N expiry dates with classification.
 * 
 * Index: Weekly expiries every Thursday (NIFTY, BANKNIFTY, FINNIFTY, NIFTYIT, MIDCPNIFTY)
 * Stocks with weekly: Weekly + Monthly (last Thursday)
 * Other stocks: Monthly (last Thursday) only
 */
export function getNextExpiries(symbol: string, count: number = 8): string[] {
  const expiries: string[] = [];
  const now = new Date();

  for (let i = 0; i < 365 && expiries.length < count; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);

    if (d.getDay() !== 4) continue; // Only Thursdays

    const dateStr = formatDate(d);
    if (expiries.includes(dateStr)) continue;

    const isIndex = (INDEX_SYMBOLS as readonly string[]).includes(symbol);
    const weekly = hasWeeklyOptions(symbol);

    if (isIndex || weekly) {
      // All Thursdays are valid expiries
      expiries.push(dateStr);
    } else {
      // Monthly: only last Thursday of month
      if (isLastThursday(d)) {
        expiries.push(dateStr);
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
  theoretical: boolean;  // Flag: this is theoretical pricing, not live
  changeInOI?: number;  // NSE-provided: change in open interest
  pChangeInOI?: number; // NSE-provided: % change in OI
}

export interface OptionChainRow {
  strike: number;
  ce: OptionLegData;
  pe: OptionLegData;
  distance: number;
  moneyness: 'ITM' | 'ATM' | 'OTM';
}

// ── PCR (Put-Call Ratio) Calculation ─────────────────────────

export interface PCRData {
  pcr: number;
  totalCEOI: number;
  totalPEOI: number;
  interpretation: string;
  signal: 'bullish' | 'bearish' | 'neutral' | 'extreme_bearish' | 'extreme_bullish';
}

export function calculatePCR(chain: OptionChainRow[]): PCRData {
  let totalCEOI = 0;
  let totalPEOI = 0;

  for (const row of chain) {
    totalCEOI += row.ce.oi;
    totalPEOI += row.pe.oi;
  }

  const pcr = totalCEOI > 0 ? totalPEOI / totalCEOI : 0;

  let interpretation: string;
  let signal: PCRData['signal'];

  if (pcr > 1.5) {
    signal = 'extreme_bearish';
    interpretation = `PCR at ${pcr.toFixed(2)} — Extremely high put writing. Market is oversold, strong support expected. Contrarian bullish signal.`;
  } else if (pcr > 1.2) {
    signal = 'bearish';
    interpretation = `PCR at ${pcr.toFixed(2)} — High put writing. Heavy support at current levels, mildly bearish sentiment.`;
  } else if (pcr > 0.8) {
    signal = 'neutral';
    interpretation = `PCR at ${pcr.toFixed(2)} — Balanced put-call activity. Neutral market sentiment.`;
  } else if (pcr > 0.5) {
    signal = 'bullish';
    interpretation = `PCR at ${pcr.toFixed(2)} — More call writing than puts. Bullish sentiment, resistance expected.`;
  } else {
    signal = 'extreme_bullish';
    interpretation = `PCR at ${pcr.toFixed(2)} — Very low PCR. Extreme bullishness, potential for reversal. Contrarian bearish signal.`;
  }

  return { pcr: Math.round(pcr * 100) / 100, totalCEOI, totalPEOI, interpretation, signal };
}

// ── Max Pain Calculation ─────────────────────────────────────

export interface MaxPainResult {
  strike: number;
  maxPainStrike: number;
  totalPainAtMax: number;
  reasoning: string;
}

/**
 * Calculate max pain — the strike at which option buyers lose the most money.
 * Sellers (institutions) tend to pin the price near max pain on expiry day.
 * 
 * Pain at strike K = Sum of (intrinsic value of all CE above K) + Sum of (intrinsic value of all PE below K)
 * Max pain = K where total pain is maximum (sellers gain most)
 */
export function calculateMaxPain(chain: OptionChainRow[], spot: number): MaxPainResult {
  let maxPainStrike = spot;
  let minTotalPain = Infinity;

  for (const row of chain) {
    let totalPain = 0;

    // CE pain: all CE with strike < currentStrike will have intrinsic value
    // Sellers lose = intrinsic value × OI
    for (const r of chain) {
      if (r.ce.oi > 0 && r.strike < row.strike) {
        totalPain += (row.strike - r.strike) * r.ce.oi;
      }
      if (r.pe.oi > 0 && r.strike > row.strike) {
        totalPain += (r.strike - row.strike) * r.pe.oi;
      }
    }

    if (totalPain < minTotalPain) {
      minTotalPain = totalPain;
      maxPainStrike = row.strike;
    }
  }

  const distanceFromSpot = ((maxPainStrike - spot) / spot * 100).toFixed(2);
  const days = 1; // Max pain is most relevant on expiry day

  let reasoning: string;
  if (Math.abs(maxPainStrike - spot) < spot * 0.005) {
    reasoning = `Max pain at ₹${maxPainStrike} (≈ ATM, ${distanceFromSpot}% from spot). Price is already near max pain — expect consolidation around this level on expiry.`;
  } else if (maxPainStrike > spot) {
    reasoning = `Max pain at ₹${maxPainStrike} (+${distanceFromSpot}% from spot). Gravitational pull upward toward max pain. More relevant within ${days} day(s) of expiry.`;
  } else {
    reasoning = `Max pain at ₹${maxPainStrike} (${distanceFromSpot}% from spot). Downward pull toward max pain. More relevant within ${days} day(s) of expiry.`;
  }

  return {
    strike: spot,
    maxPainStrike,
    totalPainAtMax: Math.round(minTotalPain),
    reasoning,
  };
}

// ── Liquidity Tier (for bid/ask spread estimation) ───────────

type LiquidityTier = 'ultra' | 'high' | 'medium' | 'low';

function getLiquidityTier(symbol: string): LiquidityTier {
  const ultra = ['NIFTY', 'BANKNIFTY'];
  const high = ['FINNIFTY', 'RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'SBIN'];
  const medium = ['AXISBANK', 'KOTAKBANK', 'BAJFINANCE', 'ITC', 'LT', 'BHARTIARTL', 'HINDUNILVR', 'TMPV'];

  if (ultra.includes(symbol)) return 'ultra';
  if (high.includes(symbol)) return 'high';
  if (medium.includes(symbol)) return 'medium';
  return 'low';
}

function getSpreadMultiplier(tier: LiquidityTier, moneyness: 'ITM' | 'ATM' | 'OTM'): number {
  // Tighter spreads for liquid names, wider for OTM
  const baseSpreads: Record<LiquidityTier, number> = {
    ultra: 0.005,  // 0.5%
    high: 0.015,   // 1.5%
    medium: 0.03,  // 3%
    low: 0.06,     // 6%
  };

  const otmMultiplier = moneyness === 'OTM' ? 2.0 : moneyness === 'ATM' ? 1.0 : 1.2;

  return baseSpreads[tier] * otmMultiplier;
}

// ── Main: Fetch Option Chain ─────────────────────────────────

export interface OptionChainResult {
  symbol: string;
  symbolType: 'index' | 'stock';
  settlementType: 'cash' | 'physical';
  underlyingPrice: number;
  change: number;
  changePct: number;
  expiryDate: string;
  expiryInfo: ExpiryInfo;
  expiryDates: string[];
  chain: OptionChainRow[];
  vix: VIXData | null;
  pcr: PCRData | null;
  maxPain: MaxPainResult | null;
  dividendYield: number;
  lotSize: number;
  dataSource: 'nse_live' | 'dhan_live' | 'theoretical';
  nseFetchTime?: number; // timestamp of NSE data fetch
}

/**
 * Build option chain from NSE live data.
 * Uses real premiums, OI, volume, IV, bid/ask from NSE.
 * Greeks are calculated via BSM using real IV from NSE (exchange doesn't provide Greeks).
 */
function buildChainFromNSE(
  nseData: NSEOptionData[],
  spot: number,
  symbol: string,
  T: number,
  r: number,
  dividendYield: number,
): OptionChainRow[] {
  const step = getStrikeStep(symbol, spot);
  const atmStrike = Math.round(spot / step) * step;

  // Build a map for quick lookup
  const nseMap = new Map<number, NSEOptionData>();
  for (const item of nseData) {
    nseMap.set(item.strikePrice, item);
  }

  const strikes = generateStrikes(spot, symbol);
  const chain: OptionChainRow[] = [];

  for (const strike of strikes) {
    const nseItem = nseMap.get(strike);
    const dist = ((strike - spot) / spot) * 100;
    const isATM = Math.abs(strike - atmStrike) < step / 2;

    let moneyness: 'ITM' | 'ATM' | 'OTM';
    if (isATM) {
      moneyness = 'ATM';
    } else if (strike < spot) {
      moneyness = 'ITM';
    } else {
      moneyness = 'OTM';
    }

    if (nseItem) {
      // ── LIVE DATA from NSE ──────────────────────────
      // Use real IV from NSE to calculate Greeks via BSM
      const ceIV = nseItem.ce?.impliedVolatility
        ? nseItem.ce.impliedVolatility / 100 // NSE gives IV as percentage (e.g. 12.35 for 12.35%)
        : 0.15;
      const peIV = nseItem.pe?.impliedVolatility
        ? nseItem.pe.impliedVolatility / 100
        : 0.15;

      // Calculate Greeks using BSM with real IV
      const ceBS = T > 0 && ceIV > 0
        ? blackScholes(spot, strike, T, r, ceIV, 'CE', dividendYield)
        : { premium: Math.max(spot - strike, 0), delta: 0, gamma: 0, theta: 0, vega: 0, iv: ceIV };
      const peBS = T > 0 && peIV > 0
        ? blackScholes(spot, strike, T, r, peIV, 'PE', dividendYield)
        : { premium: Math.max(strike - spot, 0), delta: 0, gamma: 0, theta: 0, vega: 0, iv: peIV };

      chain.push({
        strike,
        distance: Math.round(dist * 100) / 100,
        moneyness,
        ce: {
          ltp: Math.round((nseItem.ce?.lastPrice || 0) * 100) / 100,
          iv: Math.round((ceIV * 10000)) / 100, // as %
          delta: ceBS.delta,
          gamma: ceBS.gamma,
          theta: ceBS.theta,
          vega: ceBS.vega,
          oi: nseItem.ce?.openInterest || 0,
          volume: nseItem.ce?.totalTradedVolume || 0,
          bid: Math.round((nseItem.ce?.bidprice || 0) * 100) / 100,
          ask: Math.round((nseItem.ce?.askPrice || 0) * 100) / 100,
          itm: strike < spot,
          theoretical: false,
          changeInOI: nseItem.ce?.changeinOpenInterest || 0,
          pChangeInOI: nseItem.ce?.pChangeInOI || 0,
        },
        pe: {
          ltp: Math.round((nseItem.pe?.lastPrice || 0) * 100) / 100,
          iv: Math.round((peIV * 10000)) / 100,
          delta: peBS.delta,
          gamma: peBS.gamma,
          theta: peBS.theta,
          vega: peBS.vega,
          oi: nseItem.pe?.openInterest || 0,
          volume: nseItem.pe?.totalTradedVolume || 0,
          bid: Math.round((nseItem.pe?.bidprice || 0) * 100) / 100,
          ask: Math.round((nseItem.pe?.askPrice || 0) * 100) / 100,
          itm: strike > spot,
          theoretical: false,
          changeInOI: nseItem.pe?.changeinOpenInterest || 0,
          pChangeInOI: nseItem.pe?.pChangeInOI || 0,
        },
      });
    } else {
      // ── No NSE data for this strike — skip ───────────
      // Only include strikes that NSE has data for (keeps chain clean)
    }
  }

  return chain;
}

export async function fetchOptionChain(
  symbol: string,
  expiryDate: string
): Promise<OptionChainResult> {
  // 0a. Try DhanHQ Broker API live data first if configured
  if (process.env.DATA_PROVIDER === 'dhan' || process.env.DHAN_ACCESS_TOKEN) {
    try {
      const { fetchDhanOptionChain } = await import('./dhan-option-provider');
      let dhanData = await fetchDhanOptionChain(symbol, expiryDate);
      if (!dhanData || !dhanData.chain.length) {
        // Short retry for transient network glitch
        await new Promise((r) => setTimeout(r, 250));
        dhanData = await fetchDhanOptionChain(symbol, expiryDate);
      }
      if (dhanData && dhanData.chain.length > 0) {
        return dhanData;
      }
    } catch (err) {
      console.warn('[OptionChain] DhanHQ live fetch failed:', String(err).substring(0, 120));
    }
  }

  // 0b. Try NSE live data (best-effort, 5s timeout)
  let nseResult: OptionChainResult | null = null;
  try {
    const nseRaw = await Promise.race([
      fetchNSEOptionChain(symbol),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);

    if (nseRaw && nseRaw.underlyingValue > 0) {
      const spot = Math.round(nseRaw.underlyingValue * 100) / 100;
      const symbolType = getSymbolType(symbol);
      const settlementType = getSettlementType(symbol);
      const lotSize = getOptionLotSize(symbol);
      const dividendYield = getDividendYield(symbol);

      // Get expiry dates from NSE data
      const nseExpiryDates = getNSEExpiryDates(nseRaw);
      const targetExpiry = expiryDate
        ? findNearestExpiry(nseRaw, expiryDate)
        : nseExpiryDates[0];

      if (targetExpiry) {
        const expiryInfo = classifyExpiry(targetExpiry, symbol);
        const T = timeToExpiryYears(targetExpiry);
        const r = 0.07;

        // Filter NSE data for this expiry and build chain
        const nseFiltered = filterByExpiry(nseRaw, targetExpiry);
        const chain = buildChainFromNSE(nseFiltered, spot, symbol, T, r, dividendYield);

        if (chain.length > 0) {
          // Fetch VIX separately (best-effort)
          const vixData = await fetchVIX().catch(() => null);

          // Get change data from Yahoo (NSE option chain doesn't provide change)
          let change = 0;
          let changePct = 0;
          try {
            const spotData = await fetchSpot(symbol);
            change = spotData.change;
            changePct = spotData.changePct;
          } catch {
            // Non-critical, skip
          }

          nseResult = {
            symbol,
            symbolType,
            settlementType,
            underlyingPrice: spot,
            change,
            changePct,
            expiryDate: targetExpiry,
            expiryInfo,
            expiryDates: nseExpiryDates.length > 0 ? nseExpiryDates : getNextExpiries(symbol, 10),
            chain,
            vix: vixData,
            pcr: calculatePCR(chain),
            maxPain: calculateMaxPain(chain, spot),
            dividendYield,
            lotSize,
            dataSource: 'nse_live',
            nseFetchTime: Date.now(),
          };
        }
      }
    }
  } catch (err) {
    console.warn('[OptionChain] NSE fetch failed, falling back to theoretical:', String(err).substring(0, 120));
  }

  // Return NSE data if successful
  if (nseResult) return nseResult;

  // ── STRICT USER MANDATE: DO NOT USE BOGUS/THEORETICAL DATA — REPORT UNAVAILABLE ──
  throw new Error(`Live broker option data is unavailable for ${symbol}. Please verify broker connection or try refreshing.`);
}

// ── Expose spot fetcher for positions API ────────────────────

export async function fetchSpotPrice(symbol: string): Promise<number> {
  const data = await fetchSpot(symbol);
  return data.price;
}

// ── VIX API for frontend ────────────────────────────────────

export { fetchVIX, getVIXGuidance, expectedDailyMove, expectedWeeklyRange } from './vix';
export type { VIXData, VIXGuidance } from './vix';