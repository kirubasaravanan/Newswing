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
  'TATAMOTORS': { securityId: '3456', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'MARUTI': { securityId: '10999', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'SUNPHARMA': { securityId: '3351', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'WIPRO': { securityId: '3787', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'HCLTECH': { securityId: '7229', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'TATASTEEL': { securityId: '3499', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'TITAN': { securityId: '3506', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'POWERGRID': { securityId: '14977', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
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
  const securityId = sec ? sec.securityId : '13';
  const exchangeSegment = sec ? sec.exchangeSegment : 'NSE_EQ';
  const instrument = sec ? sec.instrument : 'EQUITY';

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
