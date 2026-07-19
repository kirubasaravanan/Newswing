import { NextResponse } from 'next/server';
import { fetchVIX, getVIXGuidance, expectedDailyMove, expectedWeeklyRange } from '@/lib/options/vix';

export async function GET() {
  try {
    const vix = await fetchVIX();
    const guidance = getVIXGuidance(vix.value);

    // Fetch NIFTY spot for expected move calculation
    let niftyPrice = 24500; // Fallback
    try {
      const YAHOO_HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Connection': 'close',
      };
      const end = Math.floor(Date.now() / 1000);
      const start = end - 86400;
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/^NSEI?period1=${start}&period2=${end}&interval=1d`,
        { headers: YAHOO_HEADERS }
      );
      if (res.ok) {
        const json: any = await res.json();
        niftyPrice = json?.chart?.result?.[0]?.meta?.regularMarketPrice ?? 24500;
      }
    } catch {
      // Use fallback price
    }

    return NextResponse.json({
      ...vix,
      guidance,
      expectedDailyMove: expectedDailyMove(niftyPrice, vix.value),
      expectedWeeklyRange: expectedWeeklyRange(niftyPrice, vix.value),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch VIX';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}