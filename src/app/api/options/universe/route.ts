import { NextResponse } from 'next/server';
import { getFNOUniverse } from '@/lib/trading/options-scanner';

// GET /api/options/universe — the real F&O-eligible symbol list (indices +
// Nifty50/Nifty100/FNO stocks), used by scripts/real-full-universe-backtest.mjs
// so standalone analysis scripts don't have to duplicate this list by hand.
export async function GET() {
  try {
    const symbols = getFNOUniverse();
    return NextResponse.json({ success: true, count: symbols.length, symbols });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
