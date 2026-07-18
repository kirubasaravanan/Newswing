import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { DEFAULT_STOCKS } from '@/lib/trading/default-stocks';

// GET all watchlist stocks
export async function GET() {
  try {
    const watchlist = await db.watchlistStock.findMany({ orderBy: { symbol: 'asc' } });
    if (watchlist.length === 0) {
      // Seed with default NSE stocks (metadata only — prices come from Yahoo)
      for (const s of DEFAULT_STOCKS) {
        await db.watchlistStock.create({
          data: { symbol: s.symbol, name: s.name, sector: s.sector },
        });
      }
      const seeded = await db.watchlistStock.findMany({ orderBy: { symbol: 'asc' } });
      return NextResponse.json({ success: true, stocks: seeded });
    }
    return NextResponse.json({ success: true, stocks: watchlist });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// POST add stock(s) to watchlist
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const items: { symbol: string; name?: string; sector?: string }[] = Array.isArray(body.stocks) ? body.stocks : [body];

    const added = [];
    for (const item of items) {
      const existing = await db.watchlistStock.findUnique({ where: { symbol: item.symbol.toUpperCase() } });
      if (existing) continue;

      const stock = await db.watchlistStock.create({
        data: {
          symbol: item.symbol.toUpperCase(),
          name: item.name || item.symbol,
          sector: item.sector || null,
        },
      });
      added.push(stock);
    }
    return NextResponse.json({ success: true, added, count: added.length });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// DELETE remove stock from watchlist
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    if (!symbol) return NextResponse.json({ success: false, error: 'Symbol required' }, { status: 400 });

    await db.watchlistStock.delete({ where: { symbol: symbol.toUpperCase() } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}