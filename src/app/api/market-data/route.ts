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

    for (const stock of toFetch) {
      const cached = quoteCache.get(stock.symbol);
      if (cached && Date.now() - cached.fetchedAt < QUOTE_CACHE_TTL) {
        const q = cached.quote;
        quotes.push({ symbol: stock.symbol, name: stock.name, sector: stock.sector, ...q });
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