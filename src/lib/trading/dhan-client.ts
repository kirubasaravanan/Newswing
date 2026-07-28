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
  // [FIX 2026-07-28] Was securityId '1', which is actually "NIFTY MIDCAP
  // 150" — a completely different index. The real Dhan ID for MIDCPNIFTY
  // ("Nifty Midcap Select", the options underlying) is 442, confirmed
  // directly against db/dhan-scrip-master.csv. This wrong ID is the real
  // root cause of MIDCPNIFTY falling through to the Yahoo fallback all day
  // (Dhan's own primary fetch was silently failing/wrong-instrument) —
  // fixing the ID should let it go through Dhan directly like the other
  // three indices, without ever needing Yahoo.
  'MIDCPNIFTY': { securityId: '442', exchangeSegment: 'IDX_I', instrument: 'INDEX' },

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

  // [ADDED 2026-07-28] Real-time options testing found dozens of mainline
  // Nifty50 names hitting "spot not found — skipping" every single scan
  // (the fail-closed fix from earlier today correctly stopped fabricating
  // a price for these, but they were still just missing from the map
  // entirely). IDs pulled directly from db/dhan-scrip-master.csv
  // (NSE/E/EQUITY/series=EQ rows) — the same trusted local source the
  // existing entries above were verified against, not guessed.
  'HINDUNILVR': { securityId: '1394', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'ADANIENT': { securityId: '25', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'ASIANPAINT': { securityId: '236', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'BAJAJFINSV': { securityId: '16675', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'DMART': { securityId: '19913', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'DIVISLAB': { securityId: '10940', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'NTPC': { securityId: '11630', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'ULTRACEMCO': { securityId: '11532', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'TECHM': { securityId: '13538', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'HINDALCO': { securityId: '1363', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'DRREDDY': { securityId: '881', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'ONGC': { securityId: '2475', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'COALINDIA': { securityId: '20374', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'BPCL': { securityId: '526', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'BRITANNIA': { securityId: '547', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'EICHERMOT': { securityId: '910', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'M&M': { securityId: '2031', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'HEROMOTOCO': { securityId: '1348', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'APOLLOHOSP': { securityId: '157', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'CIPLA': { securityId: '694', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'SBILIFE': { securityId: '21808', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'HDFCLIFE': { securityId: '467', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'DABUR': { securityId: '772', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'TATAPOWER': { securityId: '3426', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'GRASIM': { securityId: '1232', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'INDUSINDBK': { securityId: '5258', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'HDFCAMC': { securityId: '4244', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'JSWSTEEL': { securityId: '11723', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'TRENT': { securityId: '1964', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'ADANIPORTS': { securityId: '15083', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'TATACONSUM': { securityId: '3432', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },

  // [ADDED 2026-07-28, PART 2] Comprehensive expansion — diffed the REAL
  // live options-scanning universe (192 symbols, /api/options/universe)
  // against this map instead of reactively patching one gap at a time.
  // 122 matched directly by trading symbol; 3 more (BAJAJAUTO, VARDHMAN,
  // PBFINTECH) matched by company name after their app-side symbol didn't
  // match Dhan's own trading-symbol spelling (BAJAJ-AUTO/VTL/POLICYBZR).
  // All IDs verified against db/dhan-scrip-master.csv, series=EQ only.
  // Left OUT on purpose, not an oversight: RAJESHEXPO (real Dhan entry
  // exists but trades under restricted series "BZ", not "EQ" — same
  // fail-closed principle as the existing T2T/BE-series exclusions
  // elsewhere in this codebase) and LTIM/GUJGASLTD/PEL (genuinely not
  // found in this scrip master snapshot under any name/symbol variant
  // searched — better to fail closed than guess an ID).
  'WELSPUNLIV': { securityId: '11253', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'GODREJCP': { securityId: '10099', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'AMBUJACEM': { securityId: '1270', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'SHREECEM': { securityId: '3103', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'SIEMENS': { securityId: '3150', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'ABB': { securityId: '13', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'BOSCHLTD': { securityId: '2181', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'MOTHERSON': { securityId: '4204', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'TATAELXSI': { securityId: '3411', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'COFORGE': { securityId: '11543', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'PERSISTENT': { securityId: '18365', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'MPHASIS': { securityId: '4503', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'JSWINFRA': { securityId: '19020', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'KEI': { securityId: '13310', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'POLYCAB': { securityId: '9590', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'DEEPAKNTR': { securityId: '19943', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'SRF': { securityId: '3273', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'TORNTPHARM': { securityId: '3518', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'LALPATHLAB': { securityId: '11654', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'MAXHEALTH': { securityId: '22377', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'NHPC': { securityId: '17400', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'NMDC': { securityId: '15332', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'IOC': { securityId: '1624', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'IGL': { securityId: '11262', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'MGL': { securityId: '17534', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'PETRONET': { securityId: '11351', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'CANBK': { securityId: '10794', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'PNB': { securityId: '10666', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'BANKBARODA': { securityId: '4668', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'IDFCFIRSTB': { securityId: '11184', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'FEDERALBNK': { securityId: '1023', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'LICHSGFIN': { securityId: '1997', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'RVNL': { securityId: '9552', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'IRFC': { securityId: '2029', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'RECLTD': { securityId: '15355', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'PFC': { securityId: '14299', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'CDSL': { securityId: '21174', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'TVSMOTOR': { securityId: '8479', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'ESCORTS': { securityId: '958', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'HAL': { securityId: '2303', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'BEL': { securityId: '383', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'BHEL': { securityId: '438', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'THERMAX': { securityId: '3475', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'HAVELLS': { securityId: '9819', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'VBL': { securityId: '18921', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'DIXON': { securityId: '21690', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'ETERNAL': { securityId: '5097', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'ACC': { securityId: '22', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'BATAINDIA': { securityId: '371', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'LAURUSLABS': { securityId: '19234', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'ALKEM': { securityId: '11703', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'LUPIN': { securityId: '10440', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'AUROPHARMA': { securityId: '275', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'BIOCON': { securityId: '11373', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'ZYDUSLIFE': { securityId: '7929', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'IPCALAB': { securityId: '1633', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'TORNTPOWER': { securityId: '13786', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'SJVN': { securityId: '18883', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'HINDPETRO': { securityId: '1406', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'CHOLAFIN': { securityId: '685', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'SAMMAANCAP': { securityId: '30125', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'PNBHOUSING': { securityId: '18908', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'HINDCOPPER': { securityId: '17939', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'NATIONALUM': { securityId: '6364', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'IEX': { securityId: '220', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'EXIDEIND': { securityId: '676', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'CHOLAHLDNG': { securityId: '21740', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'ICICIGI': { securityId: '21770', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'CARERATING': { securityId: '29113', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'FACT': { securityId: '1008', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'RCF': { securityId: '2866', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'CHAMBLFERT': { securityId: '637', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'GNFC': { securityId: '1174', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'COROMANDEL': { securityId: '739', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'MANAPPURAM': { securityId: '19061', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'MUTHOOTFIN': { securityId: '23650', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'BAJAJHLDNG': { securityId: '305', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'ADANIENSOL': { securityId: '10217', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'ADANIGREEN': { securityId: '3563', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'ADANIPOWER': { securityId: '17388', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'WAAREEENER': { securityId: '25907', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'PREMIERENE': { securityId: '25049', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'SUZLON': { securityId: '12018', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'INDIAMART': { securityId: '10726', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'FIVESTAR': { securityId: '12032', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'JYOTHYLAB': { securityId: '15146', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'EMAMILTD': { securityId: '13517', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'MARICO': { securityId: '4067', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'GODREJAGRO': { securityId: '144', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'BALRAMCHIN': { securityId: '341', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'TRIDENT': { securityId: '9685', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'RAYMOND': { securityId: '2859', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'COLPAL': { securityId: '15141', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'HONAUT': { securityId: '3417', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'ENDURANCE': { securityId: '18822', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'DATAMATICS': { securityId: '11423', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'KFINTECH': { securityId: '13359', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'TATAINVEST': { securityId: '1621', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'FLUOROCHEM': { securityId: '13750', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'BEML': { securityId: '395', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'MAZDOCK': { securityId: '509', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'CUMMINSIND': { securityId: '1901', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'VGUARD': { securityId: '15362', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'KPRMILL': { securityId: '14912', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'ZENSARTECH': { securityId: '1076', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'ORIENTELEC': { securityId: '2972', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'BLUEDART': { securityId: '495', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'DELHIVERY': { securityId: '9599', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'DALBHARAT': { securityId: '8075', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'KNRCON': { securityId: '15283', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'ASHOKLEY': { securityId: '212', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'WHIRLPOOL': { securityId: '18011', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'VOLTAS': { securityId: '3718', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'BLUESTARCO': { securityId: '8311', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'AUBANK': { securityId: '21238', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'DCBBANK': { securityId: '13725', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'YESBANK': { securityId: '11915', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'MRF': { securityId: '2277', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'BALKRISIND': { securityId: '335', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'PAGEIND': { securityId: '14413', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'AARTIDRUGS': { securityId: '4481', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'NYKAA': { securityId: '6545', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'BAJAJAUTO': { securityId: '16669', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'VARDHMAN': { securityId: '2073', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
  'PBFINTECH': { securityId: '6656', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY' },
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

  if (!res || !res.timestamp) {
    console.warn(`[DhanClient] getDhanHistoricalDaily: unexpected response shape for "${symbol}" (securityId ${securityId}) — keys: ${res ? Object.keys(res).join(',') : 'null response'}`);
    return [];
  }

  // Dhan's daily timestamps are IST-midnight-anchored (00:00 IST == 18:30
  // UTC the previous day) — deriving the date via plain UTC .toISOString()
  // mislabels every candle as happening one day EARLIER than its real IST
  // trading day. Shift by +5:30 before slicing the calendar date so it
  // lands on the correct IST day (confirmed against Yahoo Finance's
  // matching real trading-day dates for the same close prices).
  const IST_OFFSET_SECONDS = 5.5 * 3600;
  const candles: any[] = [];
  for (let i = 0; i < res.timestamp.length; i++) {
    candles.push({
      date: new Date((res.timestamp[i] + IST_OFFSET_SECONDS) * 1000).toISOString().split('T')[0],
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
