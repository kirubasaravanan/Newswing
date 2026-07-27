/**
 * Data Provider Layer
 * Multi-provider market data abstraction.
 * Primary: DhanHQ API v2 (when DATA_PROVIDER=dhan)
 * Fallback: Yahoo Finance REST API
 */

import type { OHLCV } from './screening-engine';
import {
  getDhanHistoricalDaily,
  getDhanMarketQuotes,
  DHAN_SECURITY_MAP,
  getDhanConfig,
} from './dhan-client';

// ── Yahoo Finance symbol mapping ──────────────────────────
// NSE stocks use .NS suffix in Yahoo Finance

const SYMBOL_MAP: Record<string, string> = {
  'NIFTY': '^NSEI',
  'NIFTY50': '^NSEI',
  'BANKNIFTY': '^NSEBANK',
  'FINNIFTY': '^CNXFIN',
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
  // Tata Motors demerged 2025-10-01 into TMPV (continuing entity) and TMCV
  // (new listing) — both already follow the standard symbol+'.NS' Yahoo
  // convention (TMPV.NS / TMCV.NS, confirmed live), so no override entry is
  // needed here anymore; the old 'TATAMOTORS': 'TMCV.NS' override actually
  // pointed the WRONG direction for this codebase's purposes (TMCV is the
  // brand-new, historically-discontinuous listing — see dhan-client.ts's
  // DHAN_SECURITY_MAP comment for the full explanation).
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

  // ── 1. Try DhanHQ API v2 first for 100% real broker OHLCV candles ─────────────
  const dhanCfg = getDhanConfig();
  const secMeta = DHAN_SECURITY_MAP[symbol.toUpperCase()];
  if (dhanCfg.accessToken && secMeta) {
    try {
      const toDateStr = new Date().toISOString().split('T')[0];
      const fromDateObj = new Date(Date.now() - (days * 1.5 * 86400000));
      const fromDateStr = fromDateObj.toISOString().split('T')[0];

      const dhanCandles = await getDhanHistoricalDaily(symbol, fromDateStr, toDateStr);
      if (Array.isArray(dhanCandles) && dhanCandles.length > 0) {
        console.log(`[HISTORICAL DATA] Loaded ${dhanCandles.length} real candles for ${symbol} from DhanHQ Broker API`);
        historicalCache.set(cacheKey, { data: dhanCandles, fetchedAt: Date.now() });
        return { data: dhanCandles, source: 'dhan' as any };
      }
    } catch (err) {
      console.warn(`[HISTORICAL DATA] DhanHQ historical fetch failed for ${symbol}, falling back to Yahoo Finance:`, err);
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
  // ── 1. Try DhanHQ Market Feed Quote if configured ─────────
  if (process.env.DATA_PROVIDER === 'dhan') {
    const secMeta = DHAN_SECURITY_MAP[symbol.toUpperCase()];
    if (secMeta) {
      try {
        const quotesRes = await getDhanMarketQuotes([{
          securityId: secMeta.securityId,
          exchangeSegment: secMeta.exchangeSegment,
        }]);
        const segmentData = quotesRes?.data?.[secMeta.exchangeSegment];
        const eqData = segmentData?.[secMeta.securityId];
        if (eqData) {
          const ltp = eqData.last_price || eqData.ohlc?.close || eqData.average_price || 0;
          if (ltp > 0) {
            const prevClose = eqData.ohlc?.close || ltp;
            const change = ltp - prevClose;
            const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
            return {
              price: Math.round(ltp * 100) / 100,
              source: 'dhan' as any,
              quote: {
                price: Math.round(ltp * 100) / 100,
                change: Math.round(change * 100) / 100,
                changePercent: Math.round(changePercent * 100) / 100,
                volume: eqData.volume || 0,
                high: eqData.ohlc?.high || ltp,
                low: eqData.ohlc?.low || ltp,
                previousClose: Math.round(prevClose * 100) / 100,
                marketCap: null,
              },
            };
          }
        }
      } catch (err) {
        console.warn(`DhanHQ quote failed for ${symbol}:`, err);
      }
    }
  }

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

/**
 * Batch equity current-price lookup — one real Dhan quote call for ALL
 * symbols instead of the old pattern of calling getCurrentPrice()/
 * getContractCurrentPrice() once per symbol in a loop. getDhanMarketQuotes()
 * already accepted an array of securities; it was just always being called
 * with a one-item array from a per-symbol loop (found while investigating a
 * real "why is this slow" question). Equity-only (option contracts need the
 * option-chain path in getContractCurrentPrice(), not this).
 */
export async function getCurrentPricesBatch(symbols: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const needsYahoo: string[] = [];

  if (process.env.DATA_PROVIDER === 'dhan') {
    const securities: Array<{ securityId: string; exchangeSegment: string }> = [];
    const symbolByKey = new Map<string, string>();
    for (const symbol of symbols) {
      const secMeta = DHAN_SECURITY_MAP[symbol.toUpperCase()];
      if (secMeta) {
        securities.push({ securityId: secMeta.securityId, exchangeSegment: secMeta.exchangeSegment });
        symbolByKey.set(`${secMeta.exchangeSegment}:${secMeta.securityId}`, symbol);
      } else {
        needsYahoo.push(symbol);
      }
    }
    if (securities.length > 0) {
      try {
        const quotesRes = await getDhanMarketQuotes(securities);
        for (const [key, symbol] of symbolByKey.entries()) {
          const [segment, secId] = key.split(':');
          const eqData = quotesRes?.data?.[segment]?.[secId];
          const ltp = eqData?.last_price || eqData?.ohlc?.close || eqData?.average_price || 0;
          if (ltp > 0) {
            result[symbol] = Math.round(ltp * 100) / 100;
          } else {
            needsYahoo.push(symbol);
          }
        }
      } catch (err) {
        console.warn('[getCurrentPricesBatch] Dhan batch quote fetch failed, falling back to Yahoo for all:', err);
        needsYahoo.push(...symbolByKey.values());
      }
    }
  } else {
    needsYahoo.push(...symbols);
  }

  // Yahoo has no real batch-quote endpoint in this codebase, so these stay
  // per-symbol — but parallelized (Promise.allSettled), not a sequential
  // await-in-a-loop, and only for symbols the Dhan batch call above didn't
  // already resolve.
  if (needsYahoo.length > 0) {
    const yahooResults = await Promise.allSettled(
      needsYahoo.map(async (symbol) => ({ symbol, quote: await rateLimitedFetch(() => fetchYahooQuote(symbol)) }))
    );
    for (const r of yahooResults) {
      if (r.status === 'fulfilled' && r.value.quote.price > 0) {
        result[r.value.symbol] = r.value.quote.price;
      }
    }
  }

  return result;
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

/**
 * Multi-asset Current Price Resolver
 * Handles option contract symbols (e.g., BANKNIFTY_CE_56500_2026-07-23) via DhanHQ Option Chain
 * as well as normal equity stock symbols via DhanHQ Market Feed / Yahoo Finance.
 */
export async function getContractCurrentPrice(symbol: string, entryPrice: number = 0): Promise<number> {
  const parts = symbol.split('_');
  if (parts.length >= 4 && (parts[1] === 'CE' || parts[1] === 'PE')) {
    const underlying = parts[0];
    const direction = parts[1] as 'CE' | 'PE';
    const strike = parseFloat(parts[2]);
    const expiry = parts[3];

    try {
      const { fetchDhanOptionChain } = await import('@/lib/options/dhan-option-provider');
      const chain = await fetchDhanOptionChain(underlying, expiry);
      if (chain && chain.chain && chain.chain.length > 0) {
        const row = chain.chain.find(r => Math.abs(r.strike - strike) < 0.5) || chain.chain.find(r => r.strike === strike);
        const quote = direction === 'CE' ? row?.ce : row?.pe;
        if (quote && quote.ltp > 0) {
          return quote.ltp;
        }
      }
    } catch (err) {
      console.warn(`[getContractCurrentPrice] Option chain fetch failed for ${symbol}:`, err);
    }
    return entryPrice > 0 ? entryPrice : 0;
  }

  try {
    const { price } = await getCurrentPrice(symbol);
    if (price > 0) return price;
  } catch (err) {
    console.warn(`[getContractCurrentPrice] Stock quote fetch failed for ${symbol}:`, err);
  }
  return entryPrice > 0 ? entryPrice : 0;
}