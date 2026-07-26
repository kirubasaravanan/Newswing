import { NextResponse } from 'next/server';
import { getSwingUniverseStatus } from '@/lib/trading/swing-universe-status';

// On-demand only — do NOT call this from the main dashboard poll. Scans all
// 74 real-backtest-proven swing symbols (historical data + live price each),
// which is too expensive to run every few seconds. Fetch this when the user
// actually opens the swing-universe view.
export async function GET() {
  try {
    const stocks = await getSwingUniverseStatus();
    return NextResponse.json({ success: true, stocks });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
