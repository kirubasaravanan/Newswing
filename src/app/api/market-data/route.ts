import { NextResponse } from 'next/server';
import { DEFAULT_WATCHLIST, getAllProfiles } from '@/lib/trading/mock-data';
import { db } from '@/lib/db';

// GET watchlist stocks and available profiles
export async function GET() {
  try {
    // Get stocks in watchlist
    const watchlist = await db.watchlistStock.findMany({ orderBy: { symbol: 'asc' } });
    
    // If empty, seed with defaults
    if (watchlist.length === 0) {
      const profiles = getAllProfiles();
      for (const p of profiles) {
        await db.watchlistStock.create({
          data: { symbol: p.symbol, name: p.name, sector: p.sector },
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