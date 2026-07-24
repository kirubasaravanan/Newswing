/**
 * Global Markets & Cross-Asset Correlation Context
 *
 * Real US index closes, commodity prices, and USD/INR — fetched from Yahoo
 * Finance (the same data source already used throughout this app for
 * historical/quote data) — used as a sentiment/context filter for Indian
 * market decisions, never a trigger by itself. This is independent of
 * DhanHQ, so it isn't affected by any DhanHQ token/rate-limit issues.
 *
 * Real-time SGX/GIFT Nifty pre-market data isn't available via any free
 * source this app has access to, so previous-session US index performance
 * is used instead — a real, well-documented overnight sentiment cue, though
 * a weaker proxy than a genuine pre-market Nifty future would be.
 */

interface RawQuote { price: number; changePct: number; }

const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Connection': 'close',
};

async function fetchYahooQuoteRaw(ticker: string): Promise<RawQuote | null> {
  try {
    const end = Math.floor(Date.now() / 1000);
    const start = end - 5 * 86400;
    const url = `${YAHOO_CHART_URL}${encodeURIComponent(ticker)}?period1=${start}&period2=${end}&interval=1d`;
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) return null;
    const json = await res.json() as any;
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta || !meta.regularMarketPrice) return null;
    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose || price;
    const changePct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
    return { price: Math.round(price * 100) / 100, changePct: Math.round(changePct * 100) / 100 };
  } catch {
    return null;
  }
}

export interface GlobalMarketsContext {
  usSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN';
  sp500ChangePct: number | null;
  nasdaqChangePct: number | null;
  crudeOilChangePct: number | null;
  goldChangePct: number | null;
  usdInrChangePct: number | null;
  fetchedAt: number;
}

let cache: GlobalMarketsContext | null = null;
let cacheAt = 0;
const CACHE_TTL = 15 * 60 * 1000; // 15 min — global context doesn't need per-scan freshness

export async function fetchGlobalMarketsContext(): Promise<GlobalMarketsContext> {
  if (cache && Date.now() - cacheAt < CACHE_TTL) return cache;

  const [sp500, nasdaq, crude, gold, usdinr] = await Promise.all([
    fetchYahooQuoteRaw('^GSPC'),
    fetchYahooQuoteRaw('^IXIC'),
    fetchYahooQuoteRaw('CL=F'),
    fetchYahooQuoteRaw('GC=F'),
    fetchYahooQuoteRaw('INR=X'),
  ]);

  let usSentiment: GlobalMarketsContext['usSentiment'] = 'UNKNOWN';
  if (sp500 && nasdaq) {
    const avgChange = (sp500.changePct + nasdaq.changePct) / 2;
    usSentiment = avgChange > 0.3 ? 'BULLISH' : avgChange < -0.3 ? 'BEARISH' : 'NEUTRAL';
  }

  cache = {
    usSentiment,
    sp500ChangePct: sp500?.changePct ?? null,
    nasdaqChangePct: nasdaq?.changePct ?? null,
    crudeOilChangePct: crude?.changePct ?? null,
    goldChangePct: gold?.changePct ?? null,
    usdInrChangePct: usdinr?.changePct ?? null,
    fetchedAt: Date.now(),
  };
  cacheAt = Date.now();
  return cache;
}

// Sector-specific commodity/currency relevance — only applied to sectors
// they actually affect ("you don't need gold prices when trading Infosys").
const SECTOR_COMMODITY_MAP: Record<string, 'crude' | 'gold' | 'usdInr'> = {
  'Energy': 'crude', 'Oil & Gas': 'crude', 'Aviation': 'crude',
  'Jewellery': 'gold', 'Gems & Jewellery': 'gold',
  'IT': 'usdInr', 'Pharma': 'usdInr', 'Textiles': 'usdInr',
};

export function getRelevantCommodityContext(
  sector: string | undefined,
  ctx: GlobalMarketsContext
): { label: string; changePct: number } | null {
  if (!sector) return null;
  const key = SECTOR_COMMODITY_MAP[sector];
  if (!key) return null;
  if (key === 'crude' && ctx.crudeOilChangePct != null) return { label: 'Crude Oil', changePct: ctx.crudeOilChangePct };
  if (key === 'gold' && ctx.goldChangePct != null) return { label: 'Gold', changePct: ctx.goldChangePct };
  if (key === 'usdInr' && ctx.usdInrChangePct != null) return { label: 'USD/INR', changePct: ctx.usdInrChangePct };
  return null;
}
