import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentPrice } from '@/lib/trading/data-provider';

// In-memory cache for quotes (5 min TTL)
const quoteCache = new Map<string, { quote: any; fetchedAt: number }>();
const QUOTE_CACHE_TTL = 5 * 60 * 1000;

// GET /api/market-data — fetch live quotes for all watchlist stocks
export async function GET() {
  try {
    const watchlist = await db.watchlistStock.findMany({ orderBy: { symbol: 'asc' } });
    
    const quotes: Array<{
      symbol: string; name: string; sector: string | null;
      price: number; change: number; changePercent: number;
      high: number; low: number; volume: number;
    }> = [];

    // Fetch max 20 symbols per request to keep response time under ~12s
    const toFetch = watchlist.slice(0, 20);
    const rest = watchlist.slice(20);

    // Batch quotes into 1 single API request if Dhan is configured
    if (process.env.DATA_PROVIDER === 'dhan') {
      const { getDhanMarketQuotes, DHAN_SECURITY_MAP } = await import('@/lib/trading/dhan-client');
      const securities = toFetch
        .map(s => DHAN_SECURITY_MAP[s.symbol.toUpperCase()])
        .filter((meta): meta is NonNullable<typeof meta> => Boolean(meta))
        .map(meta => ({ securityId: meta.securityId, exchangeSegment: meta.exchangeSegment }));

      if (securities.length > 0) {
        try {
          const quotesRes = await getDhanMarketQuotes(securities);
          for (const stock of toFetch) {
            const meta = DHAN_SECURITY_MAP[stock.symbol.toUpperCase()];
            const q = meta ? quotesRes?.data?.[meta.exchangeSegment]?.[meta.securityId] : null;
            if (q && q.last_price > 0) {
              const ltp = q.last_price;
              const prevClose = q.ohlc?.close || ltp;
              const change = ltp - prevClose;
              const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
              const entry = {
                price: Math.round(ltp * 100) / 100,
                change: Math.round(change * 100) / 100,
                changePercent: Math.round(changePercent * 100) / 100,
                high: q.ohlc?.high || ltp,
                low: q.ohlc?.low || ltp,
                volume: q.volume || 0,
              };
              quoteCache.set(stock.symbol, { quote: entry, fetchedAt: Date.now() });
              quotes.push({ symbol: stock.symbol, name: stock.name, sector: stock.sector, ...entry });
              continue;
            }
            // Fallback to cache/individual quote if batch missed item
            const cached = quoteCache.get(stock.symbol);
            if (cached) {
              quotes.push({ symbol: stock.symbol, name: stock.name, sector: stock.sector, ...cached.quote });
            }
          }
        } catch (err) {
          console.warn('[MarketData] Batch quote fetch failed:', err);
        }
      }
    }

    // Process any remaining un-fetched stocks
    for (const stock of toFetch) {
      if (quotes.some(q => q.symbol === stock.symbol)) continue;
      const cached = quoteCache.get(stock.symbol);
      if (cached && Date.now() - cached.fetchedAt < QUOTE_CACHE_TTL) {
        quotes.push({ symbol: stock.symbol, name: stock.name, sector: stock.sector, ...cached.quote });
        continue;
      }
      try {
        const { price, quote } = await getCurrentPrice(stock.symbol);
        if (quote) {
          const entry = { price: quote.price, change: quote.change, changePercent: quote.changePercent, high: quote.high, low: quote.low, volume: quote.volume };
          quoteCache.set(stock.symbol, { quote: entry, fetchedAt: Date.now() });
          quotes.push({ symbol: stock.symbol, name: stock.name, sector: stock.sector, ...entry });
        }
      } catch {
        quotes.push({
          symbol: stock.symbol, name: stock.name, sector: stock.sector,
          price: 0, change: 0, changePercent: 0, high: 0, low: 0, volume: 0,
        });
      }
    }

    // Add rest as stale (price=0)
    for (const stock of rest) {
      quotes.push({
        symbol: stock.symbol, name: stock.name, sector: stock.sector,
        price: 0, change: 0, changePercent: 0, high: 0, low: 0, volume: 0,
      });
    }

    return NextResponse.json({ success: true, quotes });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}