/**
 * DhanHQ API v2 Client Module — Multi-Broker Routing Support
 * Official API Integration for DhanHQ Trading & Data Services.
 * Documentation: https://dhanhq.co/docs/v2/
 *
 * Supports Dual-Broker Routing:
 * 1. OPTIONS_BROKER (Account 1 for Intraday Options Engine)
 * 2. SWING_BROKER   (Account 2 for Equity Swing Engine)
 */

const DHAN_BASE_URL = 'https://api.dhan.co/v2';

declare global {
  var _dhanRateLock: Promise<unknown> | undefined;
  var _lastDhanCall: number | undefined;
}

export interface DhanConfig {
  clientId: string;
  accessToken: string;
}

function cleanStr(s: string): string {
  return s.replace(/^["']|["']$/g, '').trim();
}

export function getDhanConfig(targetEngine: 'INTRADAY_OPTIONS' | 'EQUITY_SWING' = 'INTRADAY_OPTIONS'): DhanConfig {
  if (targetEngine === 'INTRADAY_OPTIONS') {
    const clientId = cleanStr(process.env.OPTIONS_DHAN_CLIENT_ID || process.env.DHAN_CLIENT_ID || '');
    const accessToken = cleanStr(process.env.OPTIONS_DHAN_ACCESS_TOKEN || process.env.DHAN_ACCESS_TOKEN || '');
    return { clientId, accessToken };
  } else {
    const clientId = cleanStr(process.env.SWING_DHAN_CLIENT_ID || process.env.DHAN_CLIENT_ID || '');
    const accessToken = cleanStr(process.env.SWING_DHAN_ACCESS_TOKEN || process.env.DHAN_ACCESS_TOKEN || '');
    return { clientId, accessToken };
  }
}

export async function dhanFetch<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: any,
  targetEngine: 'INTRADAY_OPTIONS' | 'EQUITY_SWING' = 'INTRADAY_OPTIONS'
): Promise<T> {
  const config = getDhanConfig(targetEngine);
  if (!config.clientId || !config.accessToken) {
    throw new Error(`DhanHQ credentials missing for ${targetEngine} broker account.`);
  }

  const url = `${DHAN_BASE_URL}${endpoint}`;
  const headers: Record<string, string> = {
    'access-token': config.accessToken,
    'client-id': config.clientId,
    'Content-Type': 'application/json',
  };

  // ── Global DhanHQ API Rate Limiter Mutex (1.2s delay between all calls) ──
  if (!globalThis._dhanRateLock) globalThis._dhanRateLock = Promise.resolve();
  await (globalThis._dhanRateLock = globalThis._dhanRateLock.then(async () => {
    const now = Date.now();
    const gap = (globalThis._lastDhanCall || 0) + 1200 - now;
    if (gap > 0) await new Promise(r => setTimeout(r, gap));
    globalThis._lastDhanCall = Date.now();
  }));

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DhanHQ API Error [${response.status}]: ${errorText}`);
  }

  return response.json() as Promise<T>;
}

// ── Security ID Lookup Map (Popular Instruments) ───────────
export const DHAN_SECURITY_MAP: Record<string, { securityId: string; exchangeSegment: string; instrument: string }> = {
  // Indices
  'NIFTY': { securityId: '13', exchangeSegment: 'IDX_I', instrument: 'INDEX' },
  'NIFTY50': { securityId: '13', exchangeSegment: 'IDX_I', instrument: 'INDEX' },
  'BANKNIFTY': { securityId: '25', exchangeSegment: 'IDX_I', instrument: 'INDEX' },
  'FINNIFTY': { securityId: '27', exchangeSegment: 'IDX_I', instrument: 'INDEX' },
  'MIDCPNIFTY': { securityId: '1', exchangeSegment: 'IDX_I', instrument: 'INDEX' },

  // Top F&O Stocks (NSE_EQ)
  'RELIANCE': { securityId: '2885', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'HDFCBANK': { securityId: '1333', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'TCS': { securityId: '11536', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'INFY': { securityId: '1594', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'ICICIBANK': { securityId: '4963', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'SBIN': { securityId: '3045', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'BHARTIARTL': { securityId: '10604', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'ITC': { securityId: '1660', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'KOTAKBANK': { securityId: '1922', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'LT': { securityId: '11483', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'AXISBANK': { securityId: '5900', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'BAJFINANCE': { securityId: '317', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  // Tata Motors demerged (effective 2025-10-01): the ORIGINAL listing (this
  // security ID, unchanged) was renamed to Tata Motors Passenger Vehicles —
  // Dhan's own trading symbol for ID 3456 is now "TMPV", not "TATAMOTORS".
  // A brand-new company (TMCV, security ID 759782, listed 2025-11-12) kept
  // the "Tata Motors" name going forward but has no price history before
  // its listing date and — as of this check (2026-07-27) — no F&O contracts
  // at all yet, so it's equity-only. Verified against the bundled Dhan
  // scrip master, not guessed. See both entries below.
  'TMPV': { securityId: '3456', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'TMCV': { securityId: '759782', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'MARUTI': { securityId: '10999', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'SUNPHARMA': { securityId: '3351', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'WIPRO': { securityId: '3787', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'HCLTECH': { securityId: '7229', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'TATASTEEL': { securityId: '3499', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'TITAN': { securityId: '3506', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'POWERGRID': { securityId: '14977', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },

  // Options TOP-10 proven-symbols basket (options-proven-symbols.ts) — these
  // were previously MISSING from this map entirely, which (before the
  // fail-closed fix above) meant every one of them silently pulled NIFTY's
  // own candle data as "their" VWAP. 7 of the 10 live here; ITC, SUNPHARMA,
  // AXISBANK were already mapped above. IDs verified against the bundled
  // Dhan scrip master (db/dhan-scrip-master.csv, NSE/E/EQ rows) — cross-checked
  // the existing entries above against the same file and they match exactly,
  // so this file is a trustworthy source, not guessed.
  'PIDILITIND': { securityId: '2664', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'SOLARINDS': { securityId: '13332', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'CROMPTON': { securityId: '17094', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'BERGEPAINT': { securityId: '404', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'IRCTC': { securityId: '13611', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'VEDL': { securityId: '3063', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'UPL': { securityId: '11287', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
};

/**
 * Fetch Historical Daily Candles from DhanHQ API v2
 */
export async function getDhanHistoricalDaily(
  symbol: string,
  fromDate: string,
  toDate: string,
  targetEngine: 'INTRADAY_OPTIONS' | 'EQUITY_SWING' = 'INTRADAY_OPTIONS'
) {
  const sec = DHAN_SECURITY_MAP[symbol.toUpperCase()];
  if (!sec) {
    // Previously defaulted to securityId '13' (NIFTY) under NSE_EQ for any
    // unmapped symbol — silently fetching a completely different instrument
    // under the wrong segment and returning it as if it were real data for
    // `symbol`. Fail closed instead: no data beats wrong data.
    console.warn(`[DhanClient] getDhanHistoricalDaily: no DHAN_SECURITY_MAP entry for "${symbol}" — returning empty rather than defaulting to NIFTY's security ID.`);
    return [];
  }
  const { securityId, exchangeSegment, instrument } = sec;

  const res = await dhanFetch<any>('/charts/historical', 'POST', {
    securityId,
    exchangeSegment,
    instrument,
    expiryCode: 0,
    fromDate,
    toDate,
  }, targetEngine);

  if (!res || !res.start_Time) return [];

  const candles: any[] = [];
  for (let i = 0; i < res.start_Time.length; i++) {
    candles.push({
      date: new Date(res.start_Time[i] * 1000).toISOString().split('T')[0],
      open: res.open[i],
      high: res.high[i],
      low: res.low[i],
      close: res.close[i],
      volume: res.volume?.[i] || 0,
    });
  }

  return candles;
}

/**
 * Fetch Intraday Minute Candles from DhanHQ API v2 (POST /v2/charts/intraday).
 *
 * Used for real intraday VWAP — DhanHQ docs claim up to 5 years of minute
 * data (in 90-day chunks per request), but this was NOT independently
 * verified against a live token during development (the token was rate-
 * limit-blocked before this could be tested). Treat historical depth as
 * unconfirmed until checked against a working token; the immediate use case
 * (today's session for a live VWAP) only needs the last ~1 day regardless.
 */
export interface DhanIntradayCandle {
  timestamp: number; // epoch seconds
  open: number; high: number; low: number; close: number; volume: number;
}

export async function getDhanIntradayMinuteCandles(
  symbol: string,
  fromDate: string, // "YYYY-MM-DD HH:MM:SS"
  toDate: string,    // "YYYY-MM-DD HH:MM:SS"
  interval: '1' | '5' | '15' | '25' | '60' = '5',
  targetEngine: 'INTRADAY_OPTIONS' | 'EQUITY_SWING' = 'INTRADAY_OPTIONS'
): Promise<DhanIntradayCandle[]> {
  const sec = DHAN_SECURITY_MAP[symbol.toUpperCase()];
  if (!sec) {
    // Same fail-closed fix as getDhanHistoricalDaily above — this is the
    // path that fed Factor 20 (VWAP) in the live options scanner with
    // silently-wrong-instrument data for any symbol outside the ~20-symbol
    // map (dhan-client.ts's own DHAN_SECURITY_MAP).
    console.warn(`[DhanClient] getDhanIntradayMinuteCandles: no DHAN_SECURITY_MAP entry for "${symbol}" — returning empty rather than defaulting to NIFTY's security ID.`);
    return [];
  }
  const { securityId, exchangeSegment, instrument } = sec;

  const res = await dhanFetch<any>('/charts/intraday', 'POST', {
    securityId,
    exchangeSegment,
    instrument,
    interval,
    fromDate,
    toDate,
  }, targetEngine);

  const timestamps: number[] = res?.timestamp || res?.start_Time || [];
  if (!timestamps.length) return [];

  const candles: DhanIntradayCandle[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (res.open?.[i] == null) continue;
    candles.push({
      timestamp: timestamps[i],
      open: res.open[i], high: res.high[i], low: res.low[i], close: res.close[i],
      volume: res.volume?.[i] || 0,
    });
  }
  return candles;
}

/**
 * Fetch Live Market Feed Quotes from DhanHQ API v2
 */
export async function getDhanMarketQuotes(
  securities: Array<{ securityId: string; exchangeSegment: string }>,
  targetEngine: 'INTRADAY_OPTIONS' | 'EQUITY_SWING' = 'INTRADAY_OPTIONS'
) {
  const payload: Record<string, number[]> = {};
  for (const s of securities) {
    if (!payload[s.exchangeSegment]) payload[s.exchangeSegment] = [];
    const secIdNum = parseInt(s.securityId, 10);
    if (!isNaN(secIdNum)) {
      payload[s.exchangeSegment].push(secIdNum);
    }
  }

  return dhanFetch<any>('/marketfeed/quote', 'POST', payload, targetEngine);
}
