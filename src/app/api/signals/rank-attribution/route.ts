import { NextResponse } from 'next/server';
import { getWinRateByRankBucket } from '@/lib/trading/rank-bucket-intelligence';

// GET /api/signals/rank-attribution — real win-rate-by-RS-rank-bucket from
// closed equity swing trades (rank-N tag stamped at entry by the
// capacity-based pool fill in auto-trade/route.ts). Starts genuinely empty;
// only becomes meaningful once real trades accumulate and close.
export async function GET() {
  try {
    const buckets = await getWinRateByRankBucket();
    return NextResponse.json({ success: true, count: buckets.length, buckets });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
