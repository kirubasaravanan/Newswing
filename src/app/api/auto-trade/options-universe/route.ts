import { NextResponse } from 'next/server';
import { getOptionsUniverseStatus, OPT_TOP10_CONCURRENCY_CAP } from '@/lib/trading/options-universe-status';

export async function GET() {
  try {
    const stocks = await getOptionsUniverseStatus();
    return NextResponse.json({ success: true, stocks, concurrencyCap: OPT_TOP10_CONCURRENCY_CAP });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
