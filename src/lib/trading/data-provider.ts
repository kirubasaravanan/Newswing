/**
 * Data Provider Layer
 * Provides real market data via Yahoo Finance REST API (direct fetch)
 * with mock fallback.
 *
 * Data paths:
 *   - Historical OHLCV → Yahoo Finance chart API (up to 10 years daily)
 *   - Current/LTP price → Yahoo Finance quote API
 *   - Chart display → TradingView Widget (client-side embed)
 *   - Fallback → Mock data generator (if API fails)
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

export type DataSource = 'yahoo' | 'mock' | 'auto';

export interface DataProviderStatus {
  source: DataSource;
  lastChecked: string;
  yahooAvailable: boolean;
  symbolsCached: number;
}

// In-memory cache for historical data
const historicalCache = new Map<string, { data: OHLCV[]; fetchedAt: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Rate limiter: max ~2.5 requests per second for Yahoo Finance
const requestQueue: Array<() => Promise<void>> = [];
let isProcessing = false;
const MIN_INTERVAL = 400; // ms between requests

async function rateLimitedFetch<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    requestQueue.push(async () => {
      try {
        const result = await fn();
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
    processQueue().catch(() => {});
  });
}

async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;
  while (requestQueue.length > 0) {
    const task = requestQueue.shift()!;
    try {
      await task();
    } catch (err) {
      // Task-level errors handled by caller
    }
    await new Promise(r => setTimeout(r, MIN_INTERVAL));
  }
  isProcessing = false;
}

// ── Yahoo Finance Direct API ──────────────────────────────

const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const YAHOO_QUOTE_URL = 'https://query1.finance.yahoo.com/v7/finance/quote?';

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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

interface YahooQuoteResponse {
  quoteResponse: {
    result: Array<{
      regularMarketPrice: number;
      regularMarketChange: number;
      regularMarketChangePercent: number;
      regularMarketVolume: number;
      regularMarketDayHigh: number;
      regularMarketDayLow: number;
      regularMarketPreviousClose: number;
      marketCap: number;
      shortName: string;
    }>;
    error: any;
  };
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
  const yahooSym = toYahooSymbol(symbol);
  const url = `${YAHOO_QUOTE_URL}symbols=${encodeURIComponent(yahooSym)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketVolume,regularMarketDayHigh,regularMarketDayLow,regularMarketPreviousClose,marketCap`;

  const response = await fetch(url, { headers: YAHOO_HEADERS });
  if (!response.ok) {
    throw new Error(`Yahoo quote HTTP ${response.status} for ${yahooSym}`);
  }

  const json: YahooQuoteResponse = await response.json();

  if (json.quoteResponse?.error || !json.quoteResponse?.result?.[0]) {
    throw new Error(`Yahoo quote error for ${yahooSym}`);
  }

  const q = json.quoteResponse.result[0];
  return {
    price: q.regularMarketPrice || 0,
    change: q.regularMarketChange || 0,
    changePercent: q.regularMarketChangePercent || 0,
    volume: q.regularMarketVolume || 0,
    high: q.regularMarketDayHigh || q.regularMarketPrice || 0,
    low: q.regularMarketDayLow || q.regularMarketPrice || 0,
    previousClose: q.regularMarketPreviousClose || 0,
    marketCap: q.marketCap || null,
  };
}

// ── Main Provider Functions ───────────────────────────────

let yahooAvailable: boolean | null = null;

export async function checkYahooAvailability(): Promise<boolean> {
  try {
    const quote = await fetchYahooQuote('NIFTY50');
    yahooAvailable = !!(quote && quote.price > 0);
    return yahooAvailable;
  } catch {
    yahooAvailable = false;
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

  // Try Yahoo Finance
  if (yahooAvailable !== false) {
    try {
      const data = await rateLimitedFetch(() => fetchYahooHistorical(symbol, days));
      if (!data || data.length < 10) throw new Error('Insufficient data');
      historicalCache.set(cacheKey, { data, fetchedAt: Date.now() });
      yahooAvailable = true;
      return { data, source: 'yahoo' };
    } catch (err) {
      const msg = String(err);
      if (msg.includes('delisted') || msg.includes('No data found') || msg.includes('Not Found')) {
        console.warn(`Yahoo: ${symbol} - ${msg.substring(0, 80)}`);
      } else {
        console.error(`Yahoo Finance failed for ${symbol}:`, msg.substring(0, 120));
        yahooAvailable = false;
      }
    }
  }

  // Fallback to mock
  const { generateMockData } = await import('./mock-data');
  const mockData = generateMockData(symbol, days);
  return { data: mockData, source: 'mock' };
}

export async function getCurrentPrice(symbol: string): Promise<{
  price: number;
  source: DataSource;
  quote?: Awaited<ReturnType<typeof fetchYahooQuote>>;
}> {
  if (yahooAvailable !== false) {
    try {
      const quote = await rateLimitedFetch(() => fetchYahooQuote(symbol));
      if (quote.price > 0) {
        yahooAvailable = true;
        return { price: quote.price, source: 'yahoo', quote };
      }
    } catch (err) {
      console.error(`Yahoo quote failed for ${symbol}:`, err);
      yahooAvailable = false;
    }
  }

  // Fallback: generate mock "current" data
  const { generateMockData } = await import('./mock-data');
  const data = generateMockData(symbol, 10, new Date());
  const mockPrice = data.length > 0 ? data[data.length - 1].close : 0;
  return { price: mockPrice, source: 'mock' };
}

export function getDataProviderStatus(): DataProviderStatus {
  return {
    source: yahooAvailable ? 'yahoo' : 'mock',
    lastChecked: new Date().toISOString(),
    yahooAvailable: yahooAvailable ?? false,
    symbolsCached: historicalCache.size,
  };
}

export function clearCache(): void {
  historicalCache.clear();
  yahooAvailable = null;
}

export { fromYahooSymbol };