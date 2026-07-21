/**
 * DhanHQ API v2 Client Module
 * Official API Integration for DhanHQ Trading & Data Services.
 * Documentation: https://dhanhq.co/docs/v2/
 */

const DHAN_BASE_URL = 'https://api.dhan.co/v2';

export interface DhanConfig {
  clientId: string;
  accessToken: string;
}

export function getDhanConfig(): DhanConfig {
  const clientId = process.env.DHAN_CLIENT_ID || '';
  const accessToken = process.env.DHAN_ACCESS_TOKEN || '';
  return { clientId, accessToken };
}

export async function dhanFetch<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: any
): Promise<T> {
  const config = getDhanConfig();
  if (!config.clientId || !config.accessToken) {
    throw new Error('DhanHQ credentials missing in environment (DHAN_CLIENT_ID / DHAN_ACCESS_TOKEN)');
  }

  const url = `${DHAN_BASE_URL}${endpoint}`;
  const headers: Record<string, string> = {
    'access-token': config.accessToken,
    'client-id': config.clientId,
    'Content-Type': 'application/json',
  };

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

// ── Endpoint Wrappers ───────────────────────────────────────

/** Get account fund limit / balance */
export async function getDhanFundLimit() {
  return dhanFetch<any>('/fundlimit', 'GET');
}

/** Get historical daily OHLCV candles */
export async function getDhanHistoricalDaily(
  symbol: string,
  fromDate: string,
  toDate: string
) {
  const meta = DHAN_SECURITY_MAP[symbol.toUpperCase()] || {
    securityId: symbol,
    exchangeSegment: 'NSE_EQ',
    instrument: 'EQUITY',
  };

  return dhanFetch<{
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: number[];
    start_Time: number[];
  }>('/charts/historical', 'POST', {
    securityId: meta.securityId,
    exchangeSegment: meta.exchangeSegment,
    instrument: meta.instrument,
    fromDate,
    toDate,
  });
}

/** Get live market quotes for multiple security IDs */
export async function getDhanMarketQuotes(
  equitySecIds: number[] = [],
  fnoSecIds: number[] = []
) {
  const payload: any = {};
  if (equitySecIds.length > 0) payload.NSE_EQ = equitySecIds;
  if (fnoSecIds.length > 0) payload.NSE_FNO = fnoSecIds;

  return dhanFetch<{
    status: string;
    data: {
      NSE_EQ?: Record<string, any>;
      NSE_FNO?: Record<string, any>;
    };
  }>('/marketfeed/quote', 'POST', payload);
}
