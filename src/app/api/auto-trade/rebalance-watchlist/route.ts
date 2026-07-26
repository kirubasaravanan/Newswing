import { NextResponse } from 'next/server';
import { computeWeeklyRSRanking } from '@/lib/trading/rs-ranking';

// On-demand manual trigger for the real weekly RS ranking recompute —
// replaces the old dashboard button, which only showed a fake success toast
// and never called anything. Scans the full NSE universe for real 1W/1M/3M
// returns vs Nifty 50 (see rs-ranking.ts), so this genuinely takes a while
// (same computation dispatchWeeklyRebalanceNotice runs automatically every
// Monday 8:30-11am) — not instant, but real.
export async function POST() {
  try {
    const result = await computeWeeklyRSRanking();
    if (!result) {
      return NextResponse.json({
        success: false,
        error: 'Could not compute ranking — either a computation is already in progress, or a real Nifty 50 benchmark series was unavailable (e.g. market data unreachable).',
      }, { status: 409 });
    }
    return NextResponse.json({
      success: true,
      top7: result.top7.map(c => ({ symbol: c.symbol, rsScore: Math.round(c.rsScore * 100) / 100 })),
      vacantCount: result.vacant.length,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
