/**
 * NSE India Free Option Chain Data Provider
 *
 * Fetches REAL option chain data from NSE India's public API:
 *   - Live premiums (LTP)
 *   - Open Interest (OI) and Change in OI
 *   - Volume (total traded quantity)
 *   - Implied Volatility (IV) from exchange
 *   - Bid/Ask prices
 *   - All strikes and expiry dates
 *
 * Architecture:
 *   1. Server-side only (called from Next.js API routes) — avoids CORS
 *   2. Session management: fetches NSE homepage first to get cookies
 *   3. Rate-limited: min 1s between calls to respect NSE limits
 *   4. Graceful fallback: if NSE fails, callers fall back to theoretical BSM
 *
 * NSE API endpoints:
 *   Indices:  https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY
 *   Equities: https://www.nseindia.com/api/option-chain-equities?symbol=RELIANCE
 */

import { INDEX_SYMBOLS } from './options/black-scholes';

// ── Types ─────────────────────────────────────────────────────

export interface NSEOptionData {
  strikePrice: number;
  expiryDate: string;
  ce: {
    lastPrice: number;
    impliedVolatility: number;
    openInterest: number;
    changeinOpenInterest: number;
    pChangeInOI: number;
    totalTradedVolume: number;
    bidprice: number;
    askPrice: number;
    bidQty: number;
    askQty: number;
    totalBuyQuantity: number;
    totalSellQuantity: number;
  } | null;
  pe: {
    lastPrice: number;
    impliedVolatility: number;
    openInterest: number;
    changeinOpenInterest: number;
    pChangeInOI: number;
    totalTradedVolume: number;
    bidprice: number;
    askPrice: number;
    bidQty: number;
    askQty: number;
    totalBuyQuantity: number;
    totalSellQuantity: number;
  } | null;
}

export interface NSEOptionChainResponse {
  underlyingValue: number;     // Spot price
  underlyingSpotValue?: number;
  strikePrices: number[];
  expiryDates: string[];
  data: NSEOptionData[];
  records?: {
    expiryDates: string[];
    strikePrices: number[];
    data: NSEOptionData[];
  };
}

export interface NSESpotQuote {
  price: number;
  change: number;
  changePct: number;
  dayHigh: number;
  dayLow: number;
  open: number;
  previousClose: number;
  volume: number;
}

// ── Session Management ────────────────────────────────────────
// NSE requires cookies from the homepage before API calls work.

let nseCookies = '';
let sessionFetchedAt = 0;
const SESSION_TTL = 120_000; // Refresh session every 2 minutes

const NSE_BASE = 'https://www.nseindia.com';
const NSE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  Connection: 'keep-alive',
  Referer: 'https://www.nseindia.com/option-chain',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

async function ensureSession(): Promise<string> {
  const now = Date.now();
  if (nseCookies && now - sessionFetchedAt < SESSION_TTL) {
    return nseCookies;
  }

  try {
    // Fetch homepage to get session cookies
    const res = await fetch(NSE_BASE, {
      method: 'GET',
      headers: {
        'User-Agent': NSE_HEADERS['User-Agent'],
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    if (res.ok) {
      // Extract cookies from Set-Cookie headers
      const setCookies = res.headers.getSetCookie?.() || [];
      const cookieStr = setCookies
        .map((c) => c.split(';')[0])
        .join('; ');
      // Also get from document cookies if present
      const allCookies = [cookieStr, nseCookies].filter(Boolean).join('; ');
      nseCookies = allCookies;
      sessionFetchedAt = now;
      return nseCookies;
    }
  } catch (err) {
    console.error('[NSE] Session fetch failed:', String(err).substring(0, 100));
    // Return stale cookies if available
    return nseCookies;
  }

  return nseCookies;
}

// ── Rate Limiter ──────────────────────────────────────────────

let lastNSECall = 0;
const MIN_NSE_INTERVAL = 1500; // 1.5s between NSE API calls (conservative)

function rateLimit(): Promise<void> {
  const now = Date.now();
  const gap = lastNSECall + MIN_NSE_INTERVAL - now;
  if (gap > 0) {
    return new Promise((resolve) => setTimeout(resolve, gap));
  }
  return Promise.resolve();
}

// ── Core Fetch ────────────────────────────────────────────────

async function fetchNSE<T>(path: string): Promise<T | null> {
  await rateLimit();
  lastNSECall = Date.now();

  const cookies = await ensureSession();
  const url = `${NSE_BASE}${path}`;

  const headers: Record<string, string> = { ...NSE_HEADERS };
  if (cookies) headers['Cookie'] = cookies;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10_000), // 10s timeout
    });

    if (!res.ok) {
      console.error(`[NSE] HTTP ${res.status} for ${path}`);
      return null;
    }

    return (await res.json()) as T;
  } catch (err) {
    // On network/timeout errors, invalidate session (might be stale)
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      nseCookies = '';
      sessionFetchedAt = 0;
    }
    console.error(`[NSE] Fetch failed for ${path}:`, String(err).substring(0, 100));
    return null;
  }
}

// ── Symbol Classification ─────────────────────────────────────

function isIndex(symbol: string): boolean {
  return (INDEX_SYMBOLS as readonly string[]).includes(symbol);
}

function getNSESymbolKey(symbol: string): string {
  // NSE API uses specific symbol keys
  const map: Record<string, string> = {
    NIFTY: 'NIFTY',
    BANKNIFTY: 'BANKNIFTY',
    FINNIFTY: 'FINNIFTY',
    NIFTYIT: 'NIFTY IT',
    MIDCPNIFTY: 'MIDCPNIFTY',
  };
  return map[symbol] || symbol;
}

// ── Public API ────────────────────────────────────────────────

/**
 * Fetch option chain from NSE India for a given symbol.
 * Returns null if NSE fails (caller should fall back to theoretical).
 */
export async function fetchNSEOptionChain(
  symbol: string
): Promise<NSEOptionChainResponse | null> {
  const nseSymbol = getNSESymbolKey(symbol);
  const endpoint = isIndex(symbol)
    ? `/api/option-chain-indices?symbol=${encodeURIComponent(nseSymbol)}`
    : `/api/option-chain-equities?symbol=${encodeURIComponent(nseSymbol)}`;

  return fetchNSE<NSEOptionChainResponse>(endpoint);
}

/**
 * Fetch spot price from NSE India quote API.
 * Falls back to the option chain's underlyingValue if quote fails.
 */
export async function fetchNSESpotQuote(symbol: string): Promise<NSESpotQuote | null> {
  const nseSymbol = getNSESymbolKey(symbol);
  const endpoint = `/api/quote-equity?symbol=${encodeURIComponent(nseSymbol)}`;

  const data = await fetchNSE<{
    priceInfo: {
      lastPrice: number;
      change: number;
      pChange: number;
      intraDayHighLow: { max: number; min: number };
      open: number;
      close: number;
      previousClose: number;
    };
    preOpenMarket: { totalTradedVolume: number };
    otherInfo: any;
  }>(endpoint);

  if (!data?.priceInfo) return null;

  return {
    price: data.priceInfo.lastPrice,
    change: data.priceInfo.change,
    changePct: data.priceInfo.pChange,
    dayHigh: data.priceInfo.intraDayHighLow?.max || data.priceInfo.lastPrice,
    dayLow: data.priceInfo.intraDayHighLow?.min || data.priceInfo.lastPrice,
    open: data.priceInfo.open,
    previousClose: data.priceInfo.previousClose || data.priceInfo.close,
    volume: data.preOpenMarket?.totalTradedVolume || 0,
  };
}

// ── FII/DII institutional flow ─────────────────────────────────
// Real "smart money" signal — Forex already has this via real CFTC COT
// positioning (cot_positioning.py); equity/options had no analogous signal
// at all. NSE publishes real daily net FII/FPI and DII cash-market flow via
// the same session-cookie mechanism as the option-chain endpoints above.

export interface FiiDiiFlowEntry {
  category: 'FII/FPI' | 'DII';
  date: string; // as NSE reports it, e.g. "27-Jul-2026"
  buyValueCr: number;
  sellValueCr: number;
  netValueCr: number;
}

/**
 * Fetch the latest real FII/DII cash-market net flow (in ₹ crore) from NSE.
 * Returns null if NSE fails — caller should treat missing data as "no
 * opinion", not assume a neutral/zero flow (same convention as every other
 * real-data check this session: IV percentile, COT, session anticipation).
 */
export async function fetchFiiDiiFlow(): Promise<FiiDiiFlowEntry[] | null> {
  const data = await fetchNSE<Array<{ category: string; date: string; buyValue: string; sellValue: string; netValue: string }>>(
    '/api/fiidiiTradeReact'
  );
  if (!data || !Array.isArray(data) || data.length === 0) return null;
  return data.map((d) => ({
    category: d.category === 'DII' ? 'DII' : 'FII/FPI',
    date: d.date,
    buyValueCr: parseFloat(d.buyValue),
    sellValueCr: parseFloat(d.sellValue),
    netValueCr: parseFloat(d.netValue),
  }));
}

/**
 * Fetch the current India VIX from NSE.
 * Falls back gracefully — not critical for trading.
 */
export async function fetchNSEVIX(): Promise<number | null> {
  const data = await fetchNSE<{
    data: Array<{ indexName: string; last: number }>;
  }>('/api/allIndices');

  if (!data?.data) return null;

  const vix = data.data.find(
    (item) =>
      item.indexName === 'India VIX' || item.indexName === 'INDIA VIX'
  );
  return vix?.last ?? null;
}

// ── Utility: Filter NSE data for specific expiry ──────────────

/**
 * Filter NSE option chain data for a specific expiry date.
 * NSE returns ALL expiries in one call — this filters to just one.
 */
export function filterByExpiry(
  response: NSEOptionChainResponse,
  targetExpiry: string
): NSEOptionData[] {
  // Normalize expiry format: NSE uses "29-Jun-2025", we use "2025-06-29"
  const allData = response.records?.data || response.data || [];

  return allData.filter((item) => {
    if (!item.expiryDate) return false;
    // Try to match — NSE format varies, be flexible
    const normalised = normalizeExpiry(item.expiryDate);
    return normalised === targetExpiry || item.expiryDate === targetExpiry;
  });
}

/**
 * Get unique expiry dates from NSE response, sorted chronologically.
 * Normalizes to "YYYY-MM-DD" format.
 */
export function getExpiryDates(response: NSEOptionChainResponse): string[] {
  const allData = response.records?.data || response.data || [];
  const dateSet = new Set<string>();

  for (const item of allData) {
    if (item.expiryDate) {
      dateSet.add(normalizeExpiry(item.expiryDate));
    }
  }

  // Also check the top-level expiryDates
  if (response.expiryDates) {
    for (const d of response.expiryDates) {
      dateSet.add(normalizeExpiry(d));
    }
  }
  if (response.records?.expiryDates) {
    for (const d of response.records.expiryDates) {
      dateSet.add(normalizeExpiry(d));
    }
  }

  return Array.from(dateSet).sort();
}

// ── Expiry Normalization ──────────────────────────────────────

/**
 * Convert NSE date format ("29-Jun-2025", "29 Jun 2025", etc.) to "YYYY-MM-DD".
 */
function normalizeExpiry(nseDate: string): string {
  if (!nseDate) return '';

  // Already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(nseDate)) return nseDate;

  // NSE formats: "29-Jun-2025", "29 Jun 2025", "29-Jun-25"
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };

  const match = nseDate.match(/(\d{1,2})[-\s](\w{3})[-\s](\d{2,4})/i);
  if (!match) return nseDate;

  const day = match[1].padStart(2, '0');
  const month = months[match[2].toLowerCase()];
  let year = match[3];
  if (year.length === 2) year = `20${year}`;

  return month ? `${year}-${month}-${day}` : nseDate;
}

/**
 * Find the nearest expiry in the NSE data to a given target date.
 */
export function findNearestExpiry(
  response: NSEOptionChainResponse,
  targetDate: string
): string {
  const dates = getExpiryDates(response);
  if (dates.includes(targetDate)) return targetDate;

  // Find the closest future date
  const target = new Date(targetDate).getTime();
  const futureDates = dates.filter((d) => new Date(d).getTime() >= target - 86400000);
  return futureDates[0] || dates[0] || targetDate;
}