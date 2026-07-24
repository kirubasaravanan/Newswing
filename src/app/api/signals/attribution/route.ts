import { NextResponse } from 'next/server';
import { getFactorAttribution } from '@/lib/trading/signal-recorder';

// GET /api/signals/attribution — real per-factor win-rate attribution from
// resolved live options signals (the recorder+validator pattern). Starts
// genuinely empty; only becomes meaningful once real trades accumulate and
// close — there's no way to backfill factor breakdowns for past trades.
export async function GET() {
  try {
    const attribution = await getFactorAttribution();
    return NextResponse.json({ success: true, count: attribution.length, attribution });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
