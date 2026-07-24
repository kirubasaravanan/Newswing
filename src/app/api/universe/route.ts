import { NextResponse } from 'next/server';
import { getFullUniverse } from '@/lib/trading/universe-scanner';

// GET /api/universe — the real full NSE stock universe (Nifty50/100/F&O/
// mid/small-cap, ~600 deduped symbols from nse-universe.ts), used by
// scripts/real-full-nse-swing-backtest.mjs so standalone analysis scripts
// don't have to duplicate this list by hand (mirrors /api/options/universe).
export async function GET() {
  try {
    const stocks = getFullUniverse();
    return NextResponse.json({
      success: true,
      count: stocks.length,
      symbols: stocks.map((s) => ({ symbol: s.symbol, name: s.name, sector: s.sector, category: s.category })),
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
