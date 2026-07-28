import { NextResponse } from 'next/server';
import { getFullUniverse } from '@/lib/trading/universe-scanner';
import { fetchRealNiftyUniverse } from '@/lib/trading/real-nse-universe';

// GET /api/universe — the real full NSE stock universe, used by
// scripts/refresh-swing-proven-symbols.mts and the batch backtest so
// standalone analysis scripts don't have to duplicate this list by hand
// (mirrors /api/options/universe).
//
// Primary source: NSE's own official Nifty 100 + Midcap 150 + Smallcap 250
// index constituent lists (100+150+250=500, exactly how NSE defines the
// Nifty 500), fetched live from archives.nseindia.com. Falls back to the
// static hand-typed list in nse-universe.ts only if that live fetch fails —
// that static list has known duplicates and a few non-tradeable/stale
// entries, so it's a fallback, not the preferred source.
export async function GET() {
  try {
    const real = await fetchRealNiftyUniverse();
    const stocks = real ?? getFullUniverse();
    return NextResponse.json({
      success: true,
      count: stocks.length,
      source: real ? 'live-nse-index-constituents' : 'static-fallback',
      symbols: stocks.map((s) => ({ symbol: s.symbol, name: s.name, sector: s.sector, category: s.category })),
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
