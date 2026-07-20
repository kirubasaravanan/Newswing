/**
 * Data Provider Layer
 * Provides REAL market data via Yahoo Finance REST API (direct fetch).
 * NO mock/fallback — all data comes from Yahoo Finance.
 *
 * Data paths:
 *   - Historical OHLCV → Yahoo Finance chart API (up to 10 years daily)
 *   - Current/LTP price → Yahoo Finance chart API metadata (v7 quote is dead)
 *   - Chart display → TradingView Widget (client-side embed)
 *
 * NOTE: We use direct fetch() to Yahoo Finance instead of the yahoo-finance2
 * npm package, which causes native crashes in the Next.js server context.
 */

import type { OHLCV } from './screening-engine';

// ── Yahoo Finance symbol mapping ──────────────────────────
// NSE stocks use .NS suffix in Yahoo Finance

const SYMBOL_MAP: Record<string, string> = {
  'NIFTY50': '^NSEI',
  'BANKNIFTY': '^NSEBANK',
  'NIFTYMIDCAP': '^CNXMIDCAP',
  // NSE symbols that differ from Yahoo Finance symbols
  'BAJAJAUTO': 'BAJAJ-AUTO.NS',
  'M&M': 'M&M.NS',
  'SRF': 'SRFLTD.NS',
  'LTI': 'LTIM.NS',
  'TATACONSUM': 'TATACONSUM.NS',
  'BERGEPAINT': 'BERGEPAINT.NS',
  'MOTHERSON': 'MSUMI.NS',
  'CASTROLIND': 'CASTROLIND.NS',
  'JINDALSTEL': 'JINDALSTEL.NS',
  'JSWSTEEL': 'JSWSTEEL.NS',
  'TATAPOWER': 'TATAPOWER.NS',
  'INDUSINDBK': 'INDUSINDBK.NS',
  'GODREJCP': 'GODREJCP.NS',
  'PIDILITIND': 'PIDILITIND.NS',
  'AMBUJACEM': 'AMBUJACEM.NS',
  'SHREECEM': 'SHREECEM.NS',
  'ACC': 'ACC.NS',
  'NAM-INDIA': 'NAM-INDIA.NS',
  // Recently restructured/renamed on Yahoo
  'TATAMOTORS': 'TMCV.NS',
};

export function toYahooSymbol(nseSymbol: string): string {
  if (SYMBOL_MAP[nseSymbol]) return SYMBOL_MAP[nseSymbol];
  if (nseSymbol.endsWith('.NS')) return nseSymbol;
  return `${nseSymbol}.NS`;
}

export function fromYahooSymbol(yahooSymbol: string): string {
  return yahooSymbol.replace(/\.NS$/, '').replace(/^\^/, '');
}

// ── Data Source Config ────────────────────────────────────

export type DataSource = 'yahoo' | 'error';

export interface DataProviderStatus {
  source: DataSource;
  lastChecked: string;
  yahooAvailable: boolean;
  symbolsCached: number;
}

// In-memory cache for historical data
const historicalCache = new Map<string, { data: OHLCV[]; fetchedAt: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Rate limiter — serializes Yahoo API calls with minimum interval.
// Uses a promise-chain mutex: each call chains onto the previous one,
// ensuring only one fetch is in-flight at a time with proper spacing.
let serialLock: Promise<unknown> = Promise.resolve();
let lastCallTime = 0;
const MIN_INTERVAL = 400; // ms between Yahoo API calls

function rateLimitedFetch<T>(fn: () => Promise<T>): Promise<T> {
  // Create a deferred pair
  let resolveResult!: (v: T) => void;
  let rejectResult!: (e: unknown) => void;
  const resultPromise = new Promise<T>((res, rej) => {
    resolveResult = res;
    rejectResult = rej;
  });

  // Chain: wait for previous fetch, add delay, then run this fetch
  serialLock = serialLock.then(async () => {
    const now = Date.now();
    const gap = lastCallTime + MIN_INTERVAL - now;
    if (gap > 0) await new Promise(r => setTimeout(r, gap));
    lastCallTime = Date.now();
    try {
      const result = await fn();
      resolveResult(result);
    } catch (err) {
      rejectResult(err);
    }
  }).catch(() => {
    // Swallow to keep the chain alive — errors are propagated via rejectResult
  });

  return resultPromise;
}

// ── Yahoo Finance Direct API ──────────────────────────────

const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Connection': 'close',
};

interface YahooChartResult {
  timestamp: number[];
  indicators: {
    quote: Array<{
      open: (number | null)[];
      high: (number | null)[];
      low: (number | null)[];
      close: (number | null)[];
      volume: (number | null)[];
    }>;
  };
}

interface YahooChartMeta {
  regularMarketPrice: number;
  chartPreviousClose: number;
  regularMarketDayHigh: number;
  regularMarketDayLow: number;
  regularMarketVolume: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  currency: string;
  exchangeName: string;
  shortName: string;
  longName: string;
  instrumentType: string;
  regularMarketTime: number;
}

async function fetchYahooHistorical(
  symbol: string,
  days: number = 300
): Promise<OHLCV[]> {
  const yahooSym = toYahooSymbol(symbol);
  const endDate = Math.floor(Date.now() / 1000);
  const startDate = Math.floor((Date.now() - days * 1.5 * 86400000) / 1000);

  const url = `${YAHOO_CHART_URL}${encodeURIComponent(yahooSym)}?period1=${startDate}&period2=${endDate}&interval=1d`;

  const response = await fetch(url, { headers: YAHOO_HEADERS });
  if (!response.ok) {
    throw new Error(`Yahoo chart HTTP ${response.status} for ${yahooSym}`);
  }

  const json = await response.json() as any;

  if (!json.chart?.result?.[0]) {
    const errMsg = json.chart?.error?.description || 'No result';
    throw new Error(`Yahoo chart error for ${yahooSym}: ${errMsg}`);
  }

  const result: YahooChartResult = json.chart.result[0];
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0];

  if (!quote || !timestamps.length) {
    throw new Error(`No quote data for ${yahooSym}`);
  }

  const candles: OHLCV[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const open = quote.open?.[i];
    const high = quote.high?.[i];
    const low = quote.low?.[i];
    const close = quote.close?.[i];
    const volume = quote.volume?.[i];

    if (open != null && high != null && low != null && close != null && volume != null) {
      const d = new Date(timestamps[i] * 1000);
      candles.push({
        date: d.toISOString().split('T')[0],
        open: Math.round(open * 100) / 100,
        high: Math.round(high * 100) / 100,
        low: Math.round(low * 100) / 100,
        close: Math.round(close * 100) / 100,
        volume: volume || 0,
      });
    }
  }

  if (candles.length < 10) {
    throw new Error(`Insufficient data for ${yahooSym}: ${candles.length} candles`);
  }

  return candles;
}

// ── Yahoo Finance Quote (Current Price) ───────────────────

async function fetchYahooQuote(symbol: string): Promise<{
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high: number;
  low: number;
  previousClose: number;
  marketCap: number | null;
}> {
  // Use chart API with 5-day window — the meta object contains all quote data.
  // The v7 quote endpoint now returns 401, so this is our only free option.
  const yahooSym = toYahooSymbol(symbol);
  const end = Math.floor(Date.now() / 1000);
  const start = end - 5 * 86400;

  const url = `${YAHOO_CHART_URL}${encodeURIComponent(yahooSym)}?period1=${start}&period2=${end}&interval=1d`;

  const response = await fetch(url, { headers: YAHOO_HEADERS });
  if (!response.ok) {
    throw new Error(`Yahoo chart(quote) HTTP ${response.status} for ${yahooSym}`);
  }

  const json = await response.json() as any;
  const meta: YahooChartMeta = json.chart?.result?.[0]?.meta;

  if (!meta || !meta.regularMarketPrice) {
    throw new Error(`No quote meta for ${yahooSym}`);
  }

  const price = meta.regularMarketPrice;
  const previousClose = meta.chartPreviousClose || 0;
  const change = price - previousClose;
  const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

  return {
    price: Math.round(price * 100) / 100,
    change: Math.round(change * 100) / 100,
    changePercent: Math.round(changePercent * 100) / 100,
    volume: meta.regularMarketVolume || 0,
    high: meta.regularMarketDayHigh || price,
    low: meta.regularMarketDayLow || price,
    previousClose: Math.round(previousClose * 100) / 100,
    marketCap: null, // chart meta doesn't include marketCap
  };
}

// ── Main Provider Functions ───────────────────────────────

// Per-symbol failure tracking — avoids poisoning the entire session
// when one symbol fails (delisted, wrong ticker, etc.)
const symbolFailures = new Map<string, number>(); // symbol → consecutive failure count
const MAX_SYMBOL_FAILURES = 2;

// Global Yahoo health (checked periodically, not per-symbol)
let yahooHealthy: boolean | null = null;

export async function checkYahooAvailability(): Promise<boolean> {
  try {
    const quote = await fetchYahooQuote('NIFTY50');
    yahooHealthy = !!(quote && quote.price > 0);
    return yahooHealthy;
  } catch {
    yahooHealthy = false;
    return false;
  }
}

export async function getHistoricalData(
  symbol: string,
  days: number = 300,
  forceRefresh: boolean = false
): Promise<{ data: OHLCV[]; source: DataSource }> {
  // Check cache first
  const cacheKey = `${symbol}_${days}`;
  if (!forceRefresh) {
    const cached = historicalCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      return { data: cached.data, source: 'yahoo' };
    }
  }

  // Skip symbols that have failed repeatedly (likely delisted/wrong ticker)
  const failures = symbolFailures.get(symbol) || 0;
  if (failures >= MAX_SYMBOL_FAILURES) {
    throw new Error(`Symbol ${symbol} failed ${failures} times — skipped. Use forceRefresh or check the ticker.`);
  }

  try {
    const data = await rateLimitedFetch(() => fetchYahooHistorical(symbol, days));
    if (!data || data.length < 10) throw new Error('Insufficient data');
    historicalCache.set(cacheKey, { data, fetchedAt: Date.now() });
    symbolFailures.delete(symbol); // Reset on success
    yahooHealthy = true;
    return { data, source: 'yahoo' };
  } catch (err) {
    const msg = String(err);
    const currentFails = (symbolFailures.get(symbol) || 0) + 1;
    symbolFailures.set(symbol, currentFails);
    
    // Only set global unhealthy for non-symbol-specific errors
    if (!msg.includes('delisted') && !msg.includes('Not Found') && !msg.includes('HTTP 404') && !msg.includes('skipped')) {
      console.error(`Yahoo Finance failed for ${symbol}:`, msg.substring(0, 120));
    }
    
    throw new Error(`Failed to fetch ${symbol}: ${msg.substring(0, 100)}`);
  }
}

export async function getCurrentPrice(symbol: string): Promise<{
  price: number;
  source: DataSource;
  quote?: Awaited<ReturnType<typeof fetchYahooQuote>>;
}> {
  try {
    const quote = await rateLimitedFetch(() => fetchYahooQuote(symbol));
    if (quote.price > 0) {
      yahooHealthy = true;
      return { price: quote.price, source: 'yahoo', quote };
    }
    throw new Error(`Zero price for ${symbol}`);
  } catch (err) {
    console.error(`Yahoo quote failed for ${symbol}:`, err);
    throw err;
  }
}

export function getDataProviderStatus(): DataProviderStatus {
  return {
    source: yahooHealthy ? 'yahoo' : 'error',
    lastChecked: new Date().toISOString(),
    yahooAvailable: yahooHealthy ?? false,
    symbolsCached: historicalCache.size,
  };
}

export function clearCache(): void {
  historicalCache.clear();
  yahooHealthy = null;
  symbolFailures.clear();
}