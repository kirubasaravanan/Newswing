/**
 * DhanHQ Live Option Chain Data Provider
 * Fetches real live option chains directly from DhanHQ Broker API v2.
 *
 * ── Scrip Master CSV Strategy ─────────────────────────────────────────
 * DhanHQ updates the scrip master CSV every trading day before 9:00 AM IST.
 * It adds new weekly/monthly option contracts and removes expired ones.
 *
 * Our strategy:
 *  1. On first request: download CSV → parse → store to disk (db/dhan-scrip-master.csv)
 *  2. On subsequent requests: serve from in-memory cache (instant, sub-1ms)
 *  3. Refresh trigger: if today is a trading day AND local time > 08:30 AM IST
 *     AND the file is from a PREVIOUS calendar day → re-download in background
 *  4. Never block an option chain request waiting for the download — use the
 *     existing (slightly stale) cache and refresh in background
 */

import { dhanFetch, getDhanConfig, DHAN_SECURITY_MAP } from '@/lib/trading/dhan-client';
import { blackScholes, getOptionLotSize, getDividendYield, getSymbolType, getSettlementType, timeToExpiryYears, INDEX_SYMBOLS } from './black-scholes';
import { calculatePCR, calculateMaxPain, type OptionChainRow, type OptionChainResult, type ExpiryInfo } from './option-chain';

import fs from 'fs';
import path from 'path';

declare global {
  var _dhanRateLock: Promise<unknown> | undefined;
  var _lastDhanCall: number | undefined;
}

interface DhanScrip {
  securityId: number;
  tradingSymbol: string;
  symbol: string;
  expiryDate: string; // YYYY-MM-DD
  strike: number;
  optionType: 'CE' | 'PE';
  instrument: 'OPTIDX' | 'OPTSTK';
  exchange: 'NSE' | 'BSE'; // critical: determines which segment key to use in quote API
}

// ── Scrip Master State ────────────────────────────────────────────────
let scripCache: DhanScrip[] | null = null;
let scripFetchedAt = 0;
let scripRefreshInProgress = false;
const CACHE_FILE = path.join(process.cwd(), 'db', 'dhan-scrip-master.csv');
const SCRIP_MASTER_URL = 'https://images.dhan.co/api-data/api-scrip-master.csv';

/** Returns IST date string "YYYY-MM-DD" */
function istDateString(d: Date = new Date()): string {
  return new Date(d.getTime() + 5.5 * 3600_000)
    .toISOString().split('T')[0];
}

/** Returns IST hour (0-23) */
function istHour(d: Date = new Date()): number {
  return new Date(d.getTime() + 5.5 * 3600_000).getUTCHours();
}

/** True if today is a weekday (Mon-Fri) */
function isTradingDay(d: Date = new Date()): boolean {
  const dow = new Date(d.getTime() + 5.5 * 3600_000).getUTCDay();
  return dow >= 1 && dow <= 5; // Mon=1 … Fri=5
}

/** Check if the local disk file is from a previous calendar day (stale) */
function isScripFileStaleTodayIST(): boolean {
  if (!fs.existsSync(CACHE_FILE)) return true;
  const mtime = fs.statSync(CACHE_FILE).mtimeMs;
  const fileDate = istDateString(new Date(mtime));
  const today = istDateString();
  return fileDate !== today;
}

/** Parse the raw CSV text into DhanScrip array (only OPTIDX/OPTSTK rows) */
function parseScripCsv(text: string): DhanScrip[] {
  const lines = text.split('\n');
  const scrips: DhanScrip[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || (!line.startsWith('NSE,D,') && !line.startsWith('BSE,D,'))) continue;

    const parts = line.split(',');
    const instrument = parts[3];
    if (instrument !== 'OPTSTK' && instrument !== 'OPTIDX') continue;

    const secId = parseInt(parts[2], 10);
    const tradingSymbol = parts[5];
    const expiryRaw = parts[8]; // e.g. "2026-07-30 15:30:00"
    const strike = parseFloat(parts[9]);
    const optionType = parts[10] as 'CE' | 'PE';

    if (isNaN(secId) || isNaN(strike)) continue;

    // Extract base symbol
    let symbol = parts[15] || '';
    if (!symbol || symbol === 'OPTSTK' || symbol === 'OPTIDX') {
      const symbolMatch = tradingSymbol.match(/^([A-Z0-9]+)-/);
      symbol = symbolMatch ? symbolMatch[1] : tradingSymbol.split('-')[0];
    }

    const expiryDate = expiryRaw ? expiryRaw.split(' ')[0] : '';

    scrips.push({
      securityId: secId,
      tradingSymbol,
      symbol: symbol.toUpperCase(),
      expiryDate,
      strike,
      optionType,
      instrument: instrument as 'OPTIDX' | 'OPTSTK',
      exchange: (line.startsWith('BSE,') ? 'BSE' : 'NSE') as 'NSE' | 'BSE',
    });
  }
  return scrips;
}

/** Background refresh: download fresh CSV without blocking callers */
async function refreshScripMasterInBackground(): Promise<void> {
  if (scripRefreshInProgress) return;
  scripRefreshInProgress = true;

  console.log('[ScripMaster] 🔄 Background refresh started (DhanHQ daily update)...');
  try {
    const res = await fetch(SCRIP_MASTER_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    // Save to disk
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, text, 'utf8');

    // Update in-memory cache atomically
    const parsed = parseScripCsv(text);
    scripCache = parsed;
    scripFetchedAt = Date.now();

    const totalContracts = parsed.length;
    const expiredBefore = parsed.filter(s => new Date(s.expiryDate) < new Date()).length;
    console.log(`[ScripMaster] ✅ Refreshed: ${totalContracts.toLocaleString()} contracts (${expiredBefore} expired), saved to disk`);
  } catch (err) {
    console.warn('[ScripMaster] ⚠️ Background refresh failed:', String(err).substring(0, 100));
  } finally {
    scripRefreshInProgress = false;
  }
}

/** Export scrip master status for the /api/data-status endpoint */
export function getScripMasterStatus() {
  const fileExists = fs.existsSync(CACHE_FILE);
  const fileMtime = fileExists ? fs.statSync(CACHE_FILE).mtimeMs : 0;
  const fileDate = fileMtime ? istDateString(new Date(fileMtime)) : 'N/A';
  const today = istDateString();
  return {
    inMemoryCount: scripCache?.length || 0,
    diskFileExists: fileExists,
    diskFileDate: fileDate,
    diskFileSizeKB: fileExists ? Math.round(fs.statSync(CACHE_FILE).size / 1024) : 0,
    isStale: fileDate !== today,
    isTradingDay: isTradingDay(),
    refreshInProgress: scripRefreshInProgress,
    lastRefreshedAt: scripFetchedAt ? new Date(scripFetchedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Never',
  };
}

async function getDhanScrips(): Promise<DhanScrip[]> {
  const now = Date.now();

  // ── Return from memory cache if fresh (last fetched < 1 hour ago) ─────
  if (scripCache && now - scripFetchedAt < 3_600_000) {
    // Trigger background refresh if the disk file is from a previous day AND market is open/about to open
    if (isTradingDay() && istHour() >= 8 && isScripFileStaleTodayIST() && !scripRefreshInProgress) {
      refreshScripMasterInBackground(); // fire-and-forget
    }
    return scripCache;
  }

  // ── Try to serve from disk cache (fast, avoids 24 MB download on restart) ─
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const text = fs.readFileSync(CACHE_FILE, 'utf8');
      const parsed = parseScripCsv(text);
      if (parsed.length > 0) {
        scripCache = parsed;
        scripFetchedAt = now;
        console.log(`[ScripMaster] 📂 Loaded ${parsed.length.toLocaleString()} contracts from disk cache (${istDateString(new Date(fs.statSync(CACHE_FILE).mtimeMs))})`);

        // If disk file is stale AND it's a trading day after 8:30 AM → refresh in background
        if (isTradingDay() && istHour() >= 8 && isScripFileStaleTodayIST()) {
          console.log('[ScripMaster] 📅 Disk cache is from a previous trading day — triggering background refresh...');
          refreshScripMasterInBackground(); // non-blocking
        }
        return scripCache;
      }
    }
  } catch (diskErr) {
    console.warn('[ScripMaster] Disk read failed, downloading fresh copy...');
  }

  // ── No cache at all — must download now (first run) ───────────────────
  console.log('[ScripMaster] 📥 First-time download of DhanHQ scrip master CSV (~24 MB)...');
  try {
    const res = await fetch(SCRIP_MASTER_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, text, 'utf8');

    const parsed = parseScripCsv(text);
    scripCache = parsed;
    scripFetchedAt = now;
    console.log(`[ScripMaster] ✅ Downloaded and cached ${parsed.length.toLocaleString()} option contracts`);

    // Dispatch Discord Alert for Scrip Master Update
    try {
      const { sendDiscordScripMasterUpdate } = await import('@/lib/notifications/discord');
      const timeStr = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
      await sendDiscordScripMasterUpdate(parsed.length, `${timeStr} IST`);
    } catch (alertErr) {
      console.warn('[ScripMaster Alert] Non-blocking alert error:', alertErr);
    }

    return scripCache;
  } catch (err) {
    console.error('[DhanOptionProvider] Failed to fetch Dhan scrip master:', err);
    return scripCache || [];
  }
}


export async function fetchDhanOptionChain(
  symbol: string,
  targetExpiry: string
): Promise<OptionChainResult | null> {
  const config = getDhanConfig();
  if (!config.clientId || !config.accessToken) return null;

  try {
    const scrips = await getDhanScrips();
    if (!scrips.length) return null;

    const symUpper = symbol.toUpperCase();
    
    // Filter scrips matching exact symbol (handles NIFTY / NIFTY50 aliases and exact stock symbols)
    const matchingScrips = scrips.filter((s) => {
      if (symUpper === 'NIFTY' || symUpper === 'NIFTY50') {
        return s.symbol === 'NIFTY' || s.symbol === 'NIFTY50';
      }
      if (symUpper === 'BANKNIFTY') {
        return s.symbol === 'BANKNIFTY';
      }
      if (symUpper === 'FINNIFTY') {
        return s.symbol === 'FINNIFTY';
      }
      return s.symbol === symUpper;
    });

    if (!matchingScrips.length) return null;

    // Prefer NSE exchange contracts (official F&O market strikes)
    const nseMatchingScrips = matchingScrips.filter((s) => s.exchange === 'NSE');
    const activeScrips = nseMatchingScrips.length > 0 ? nseMatchingScrips : matchingScrips;

    // Get available expiries (filter out past expired dates)
    const todayStr = new Date().toISOString().split('T')[0];
    const expirySet = new Set<string>();
    activeScrips.forEach((s) => {
      if (s.expiryDate && s.expiryDate >= todayStr) expirySet.add(s.expiryDate);
    });
    const availableExpiries = Array.from(expirySet).sort();
    if (!availableExpiries.length) return null;

    const selectedExpiry = targetExpiry && availableExpiries.includes(targetExpiry)
      ? targetExpiry
      : availableExpiries[0];

    // Scrips for selected expiry
    const expiryScrips = activeScrips.filter((s) => s.expiryDate === selectedExpiry);
    if (!expiryScrips.length) return null;

    const allStrikes = Array.from(new Set(expiryScrips.map((s) => s.strike))).sort((a, b) => a - b);

    // Group all scrips for this expiry by strike, prefer NSE over BSE
    const candidateByStrike = new Map<number, DhanScrip[]>();
    for (const s of expiryScrips) {
      if (!candidateByStrike.has(s.strike)) candidateByStrike.set(s.strike, []);
      candidateByStrike.get(s.strike)!.push(s);
    }

    // For each strike: prefer NSE scrips if available, else fall back to BSE
    const candidateScrips: DhanScrip[] = [];
    for (const [, scrips] of candidateByStrike) {
      const nseScrips = scrips.filter((s) => s.exchange === 'NSE');
      const chosen = nseScrips.length > 0 ? nseScrips : scrips;
      candidateScrips.push(...chosen);
    }

    // ── Step 2: Build SINGLE batch payload grouped by exchange segment ──
    // NSE options → NSE_FNO | BSE options → BSE_FNO | spot index → its own segment
    const spotMeta = DHAN_SECURITY_MAP[symUpper];
    const quotesMap = new Map<number, any>();
    let underlyingPrice = 0;

    const nseIds = candidateScrips.filter(s => s.exchange === 'NSE').map(s => s.securityId);
    const bseIds = candidateScrips.filter(s => s.exchange === 'BSE').map(s => s.securityId);

    const batchPayload: Record<string, number[]> = {};
    if (nseIds.length > 0) batchPayload['NSE_FNO'] = nseIds;
    if (bseIds.length > 0) batchPayload['BSE_FNO'] = bseIds;

    // Add spot instrument to the same batch call
    if (spotMeta) {
      const spotIdNum = parseInt(spotMeta.securityId, 10);
      if (!isNaN(spotIdNum)) {
        if (!batchPayload[spotMeta.exchangeSegment]) batchPayload[spotMeta.exchangeSegment] = [];
        batchPayload[spotMeta.exchangeSegment].push(spotIdNum);
      }
    }

    // Rate-limiter mutex to prevent DhanHQ 429 Too Many Requests errors
    if (!globalThis._dhanRateLock) globalThis._dhanRateLock = Promise.resolve();
    await (globalThis._dhanRateLock = globalThis._dhanRateLock.then(async () => {
      const now = Date.now();
      const gap = (globalThis._lastDhanCall || 0) + 1200 - now;
      if (gap > 0) await new Promise(r => setTimeout(r, gap));
      globalThis._lastDhanCall = Date.now();
    }));

    try {
      const res = await dhanFetch<any>('/marketfeed/quote', 'POST', batchPayload);

      if (res?.data && typeof res.data === 'object') {
        for (const segmentObj of Object.values(res.data)) {
          if (segmentObj && typeof segmentObj === 'object') {
            for (const [idStr, q] of Object.entries(segmentObj as Record<string, any>)) {
              quotesMap.set(parseInt(idStr, 10), q);
            }
          }
        }
      }

      // Extract live spot price from the batch response
      if (spotMeta) {
        const spotQ = res?.data?.[spotMeta.exchangeSegment]?.[spotMeta.securityId];
        if (spotQ?.last_price > 0) {
          underlyingPrice = spotQ.last_price;
          console.log(`[DhanOptionProvider] Live spot for ${symUpper}: ₹${underlyingPrice}`);
        }
      }
    } catch (err) {
      console.warn(`[DhanOptionProvider] Batch quote failed:`, String(err).substring(0, 120));
      return null;
    }

    if (quotesMap.size === 0) return null;

    const midAtmIndex = Math.floor(allStrikes.length / 2);

    // Fallback: use mid-strike value if live spot not found in response
    if (underlyingPrice === 0) {
      underlyingPrice = allStrikes[midAtmIndex] || 0;
      console.warn(`[DhanOptionProvider] Spot not found for ${symUpper}, using mid-strike ${underlyingPrice} as estimate`);
    }

    // Filter scrips and build full quotes map for all scrips in this expiry
    const strikesMap = new Map<number, { ceScrip?: DhanScrip; peScrip?: DhanScrip }>();
    for (const scrip of expiryScrips) {
      const existing = strikesMap.get(scrip.strike) || {};
      if (scrip.optionType === 'CE') existing.ceScrip = scrip;
      if (scrip.optionType === 'PE') existing.peScrip = scrip;
      strikesMap.set(scrip.strike, existing);
    }

    // Build raw chain for all strikes to evaluate live active market quotes
    const rawRows: { strike: number; ceLtp: number; peLtp: number; ceOI: number; peOI: number; ceVol: number; peVol: number; ceQuote: any; peQuote: any }[] = [];
    for (const strike of Array.from(strikesMap.keys()).sort((a, b) => a - b)) {
      const pair = strikesMap.get(strike)!;
      const ceQuote = pair.ceScrip ? quotesMap.get(pair.ceScrip.securityId) : null;
      const peQuote = pair.peScrip ? quotesMap.get(pair.peScrip.securityId) : null;

      const ceLtp = ceQuote?.last_price || 0;
      const peLtp = peQuote?.last_price || 0;
      const ceOI = ceQuote?.oi ?? ceQuote?.open_interest ?? ceQuote?.openInterest ?? 0;
      const peOI = peQuote?.oi ?? peQuote?.open_interest ?? peQuote?.openInterest ?? 0;
      const ceVol = ceQuote?.volume ?? ceQuote?.vol ?? 0;
      const peVol = peQuote?.volume ?? peQuote?.vol ?? 0;

      rawRows.push({ strike, ceLtp, peLtp, ceOI, peOI, ceVol, peVol, ceQuote, peQuote });
    }

    // Filter out phantom non-traded strikes (where neither CE nor PE has active price, OI, or volume)
    const validRows = rawRows.filter((r) => r.ceLtp > 0 || r.peLtp > 0 || r.ceOI > 0 || r.peOI > 0 || r.ceVol > 0 || r.peVol > 0);
    const activeRows = validRows.length > 0 ? validRows : rawRows;
    const activeStrikes = activeRows.map((r) => r.strike);

    // Calculate exact ATM strike based on valid active exchange contracts closest to live spot price
    let liveAtmIndex = 0;
    let liveMinDiff = Infinity;
    for (let i = 0; i < activeStrikes.length; i++) {
      const diff = Math.abs(activeStrikes[i] - underlyingPrice);
      if (diff < liveMinDiff) {
        liveMinDiff = diff;
        liveAtmIndex = i;
      }
    }

    const atmStrike = activeStrikes[liveAtmIndex] || activeStrikes[0];

    // Select exactly ±3 active strikes around ATM (7 total strikes)
    const startIdx = Math.max(0, liveAtmIndex - 3);
    const endIdx = Math.min(activeStrikes.length, liveAtmIndex + 4);
    const targetRows = activeRows.slice(startIdx, endIdx);

    const symbolType = getSymbolType(symbol);
    const settlementType = getSettlementType(symbol);
    const lotSize = getOptionLotSize(symbol);
    const dividendYield = getDividendYield(symbol);

    const now = new Date();
    const expiry = new Date(selectedExpiry + 'T15:30:00+05:30');
    const daysToExpiry = Math.max(Math.ceil((expiry.getTime() - now.getTime()) / (86400 * 1000)), 0);
    const T = daysToExpiry / 365;
    const r = 0.07;

    const chain: OptionChainRow[] = [];

    for (const rRow of targetRows) {
      const { strike, ceLtp, peLtp, ceOI, peOI, ceQuote, peQuote } = rRow;

      const ceBid = ceQuote?.depth?.buy?.[0]?.price || (ceLtp > 0 ? Math.round(ceLtp * 0.98 * 100) / 100 : 0);
      const ceAsk = ceQuote?.depth?.sell?.[0]?.price || (ceLtp > 0 ? Math.round(ceLtp * 1.02 * 100) / 100 : 0);
      const peBid = peQuote?.depth?.buy?.[0]?.price || (peLtp > 0 ? Math.round(peLtp * 0.98 * 100) / 100 : 0);
      const peAsk = peQuote?.depth?.sell?.[0]?.price || (peLtp > 0 ? Math.round(peLtp * 1.02 * 100) / 100 : 0);

      const cePrevOI = ceQuote?.previous_close_oi ?? ceQuote?.prev_close_oi ?? ceQuote?.prev_oi ?? ceOI;
      const pePrevOI = peQuote?.previous_close_oi ?? peQuote?.prev_close_oi ?? peQuote?.prev_oi ?? peOI;

      const ceChangeInOI = ceQuote?.change_in_oi ?? ceQuote?.changeInOI ?? (ceOI - cePrevOI);
      const peChangeInOI = peQuote?.change_in_oi ?? peQuote?.changeInOI ?? (peOI - pePrevOI);

      const ceVol = ceQuote?.volume ?? ceQuote?.vol ?? ceQuote?.traded_volume ?? 0;
      const peVol = peQuote?.volume ?? peQuote?.vol ?? peQuote?.traded_volume ?? 0;

      const dist = Math.round(((strike - underlyingPrice) / underlyingPrice) * 10000) / 100;
      const isATM = strike === atmStrike;

      // Greeks calculation via BSM using real Dhan LTP
      const ceBS = T > 0 && ceLtp > 0
        ? blackScholes(underlyingPrice, strike, T, r, 0.20, 'CE', dividendYield)
        : { delta: 0, gamma: 0, theta: 0, vega: 0 };
      const peBS = T > 0 && peLtp > 0
        ? blackScholes(underlyingPrice, strike, T, r, 0.20, 'PE', dividendYield)
        : { delta: 0, gamma: 0, theta: 0, vega: 0 };

      chain.push({
        strike,
        distance: dist,
        moneyness: isATM ? 'ATM' : strike < underlyingPrice ? 'ITM' : 'OTM',
        ce: {
          ltp: Math.round(ceLtp * 100) / 100,
          iv: 20,
          delta: ceBS.delta,
          gamma: ceBS.gamma,
          theta: ceBS.theta,
          vega: ceBS.vega,
          oi: ceOI,
          volume: ceVol,
          bid: Math.round(ceBid * 100) / 100,
          ask: Math.round(ceAsk * 100) / 100,
          itm: strike < underlyingPrice,
          theoretical: false,
          changeInOI: ceChangeInOI,
        },
        pe: {
          ltp: Math.round(peLtp * 100) / 100,
          iv: 20,
          delta: peBS.delta,
          gamma: peBS.gamma,
          theta: peBS.theta,
          vega: peBS.vega,
          oi: peOI,
          volume: peVol,
          bid: Math.round(peBid * 100) / 100,
          ask: Math.round(peAsk * 100) / 100,
          itm: strike > underlyingPrice,
          theoretical: false,
          changeInOI: peChangeInOI,
        },
      });
    }

    const expiryInfo: ExpiryInfo = {
      date: selectedExpiry,
      label: `${selectedExpiry} (${daysToExpiry}d)`,
      type: daysToExpiry <= 7 ? 'near_week' : 'monthly',
      daysToExpiry,
      isIndex: (INDEX_SYMBOLS as readonly string[]).includes(symbol),
      isWeekly: (INDEX_SYMBOLS as readonly string[]).includes(symbol),
      isCurrentMonth: true,
    };

    return {
      symbol,
      symbolType,
      settlementType,
      underlyingPrice,
      change: 0,
      changePct: 0,
      expiryDate: selectedExpiry,
      expiryInfo,
      expiryDates: availableExpiries,
      chain,
      vix: null,
      pcr: calculatePCR(chain),
      maxPain: calculateMaxPain(chain, underlyingPrice),
      dividendYield,
      lotSize,
      dataSource: 'dhan_live',
      nseFetchTime: Date.now(),
    };
  } catch (err) {
    console.error('[DhanOptionProvider] Error fetching Dhan option chain:', err);
    return null;
  }
}
