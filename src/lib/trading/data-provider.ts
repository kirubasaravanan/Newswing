/**
 * Data Provider Layer
 * Provides real market data via Yahoo Finance with mock fallback.
 * 
 * Data paths:
 *   - Historical OHLCV → Yahoo Finance (up to 10 years daily)
 *   - Current/LTP price → Yahoo Finance quote
 *   - Chart display → TradingView Widget (client-side embed)
 *   - Fallback → Mock data generator (if API fails)
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
  // Most NSE stocks: RELIANCE → RELIANCE.NS
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

// Rate limiter: max 2 requests per second for Yahoo Finance free tier
const requestQueue: Array<() => Promise<void>> = [];
let isProcessing = false;
const MIN_INTERVAL = 350; // ms between requests

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
    // Ensure queue processing doesn't crash on unhandled rejections
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
      // Swallow task-level errors — they're handled by the caller via resolve/reject
    }
    await new Promise(r => setTimeout(r, MIN_INTERVAL));
  }
  isProcessing = false;
}

// ── Yahoo Finance Historical Data ─────────────────────────

// Singleton Yahoo Finance v4 instance
let yfInstance: any = null;
async function getYahooFinance() {
  if (!yfInstance) {
    const mod = await import('yahoo-finance2');
    yfInstance = new mod.default({ 
      suppressNotices: ['yahooSurvey'],
      validation: { logErrors: false },
    });
  }
  return yfInstance;
}

async function fetchYahooHistorical(
  symbol: string,
  days: number = 300
): Promise<OHLCV[]> {
  const yahooFinance = await getYahooFinance();
  const yahooSym = toYahooSymbol(symbol);
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days * 1.5);

  const result = await yahooFinance.chart(yahooSym, {
    period1: startDate,
    period2: endDate,
    interval: '1d' as const,
  });

  if (!result || !result.quotes || result.quotes.length === 0) {
    throw new Error(`No data returned for ${yahooSym}`);
  }

  const candles: OHLCV[] = result.quotes
    .filter((q: any) => q.close != null && q.open != null && q.high != null && q.low != null && q.volume != null)
    .map((q: any) => ({
      date: typeof q.date === 'string' ? q.date.split('T')[0] : (q.date?.toISOString?.()?.split('T')[0] || new Date().toISOString().split('T')[0]),
      open: Math.round(q.open * 100) / 100,
      high: Math.round(q.high * 100) / 100,
      low: Math.round(q.low * 100) / 100,
      close: Math.round(q.close * 100) / 100,
      volume: q.volume || 0,
    }));

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
  const yahooFinance = await getYahooFinance();
  const yahooSym = toYahooSymbol(symbol);
  const quote = await yahooFinance.quote(yahooSym);
  return {
    price: quote.regularMarketPrice || 0,
    change: quote.regularMarketChange || 0,
    changePercent: quote.regularMarketChangePercent || 0,
    volume: quote.regularMarketVolume || 0,
    high: quote.regularMarketDayHigh || quote.regularMarketPrice || 0,
    low: quote.regularMarketDayLow || quote.regularMarketPrice || 0,
    previousClose: quote.regularMarketPreviousClose || 0,
    marketCap: quote.marketCap || null,
  };
}

// ── Main Provider Functions ───────────────────────────────

let yahooAvailable: boolean | null = null;

export async function checkYahooAvailability(): Promise<boolean> {
  try {
    const yahooFinance = await getYahooFinance();
    const quote = await yahooFinance.quote('^NSEI');
    yahooAvailable = !!(quote && quote.regularMarketPrice);
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
      // Don't permanently disable yahoo for per-symbol failures (e.g. delisted)
      const msg = String(err);
      if (msg.includes('delisted') || msg.includes('No data found')) {
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
}

export { fromYahooSymbol };