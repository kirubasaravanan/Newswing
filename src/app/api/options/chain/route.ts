import { NextRequest, NextResponse } from 'next/server';
import { fetchOptionChain, getNextExpiries } from '@/lib/options/option-chain';

// In-memory cache (30s TTL)
const chainCache = new Map<string, { data: any; fetchedAt: number }>();
const CACHE_TTL = 3_000;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol') || 'NIFTY';
    const expiry = searchParams.get('expiry') || '';

    // Get default expiry if not provided
    const targetExpiry = expiry || getNextExpiries(symbol, 1)[0] || '';
    if (!targetExpiry) {
      return NextResponse.json({ success: false, error: 'No expiry dates available' }, { status: 400 });
    }

    const cacheKey = `${symbol}:${targetExpiry}`;
    const cached = chainCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      return NextResponse.json({ success: true, ...cached.data, cached: true });
    }

    let data: any = null;
    try {
      data = await fetchOptionChain(symbol, targetExpiry);
    } catch (err) {
      console.error(`[API options/chain ERROR for ${symbol}]:`, err);
      // Transient error retry after 300ms delay
      await new Promise((r) => setTimeout(r, 300));
      data = await fetchOptionChain(symbol, targetExpiry).catch((retryErr) => {
        console.error(`[API options/chain RETRY ERROR for ${symbol}]:`, retryErr);
        return null;
      });
    }

    if (data && data.chain && data.chain.length > 0) {
      chainCache.set(cacheKey, { data, fetchedAt: Date.now() });

      const atmRow = data.chain.find((r: any) => r.moneyness === 'ATM') || data.chain[Math.floor(data.chain.length / 2)];
      console.log(`[REAL OPTIONS FEED] Symbol: ${symbol.padEnd(10)} | Spot: ₹${String(data.underlyingPrice).padEnd(8)} | Expiry: ${data.expiryDate} | Source: ${data.dataSource}`);
      if (atmRow) {
        console.log(`[REAL OPTIONS FEED] ATM Strike: ${String(atmRow.strike).padEnd(6)} | CE LTP: ₹${String(atmRow.ce.ltp).padEnd(7)} (OI: ${atmRow.ce.oi}) | PE LTP: ₹${String(atmRow.pe.ltp).padEnd(7)} (OI: ${atmRow.pe.oi})`);
      }

      return NextResponse.json({ success: true, ...data });
    }

    return NextResponse.json({
      success: false,
      error: `Live broker option feed for ${symbol} temporarily busy. Please click Refresh.`,
    }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 200 });
  }
}