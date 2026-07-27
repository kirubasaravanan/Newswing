import { NextRequest, NextResponse } from 'next/server';
import { getTradePostmortems, computePostmortemStats } from '@/lib/trading/postmortem';
import { checkEquityPostExitMovement, checkOptionsPostExitMovement } from '@/lib/trading/postexit-check';

// GET /api/postmortem?assetClass=equity|options|all&limit=100&includePostExit=true
// Real per-trade post-mortem: entry reasons/score/confidence (joined from
// SignalRecord), exit reason, hold duration, and options' decisionVote
// detail — plus aggregate stats (win rate, P&L-by-exit-reason, median
// duration) that didn't exist anywhere in this codebase before.
//
// includePostExit=true additionally checks real market data for the window
// after each trade closed (next few daily bars for equity, next 30min of
// the real underlying for options) to answer "was the exit actually
// justified, or did we leave profit on the table" — ported from the same
// check built for the Forex engine this session. Off by default and capped
// to the 10 most recent trades since it makes real external API calls per
// trade (Dhan/Yahoo) rather than reading from the local DB.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const assetClassParam = searchParams.get('assetClass');
    const assetClass = assetClassParam === 'equity' || assetClassParam === 'options' ? assetClassParam : 'all';
    const limit = Math.min(500, Math.max(1, Number(searchParams.get('limit')) || 100));
    const includePostExit = searchParams.get('includePostExit') === 'true';

    const trades = await getTradePostmortems(assetClass, limit);
    const stats = computePostmortemStats(trades);

    let postExitById: Record<string, unknown> = {};
    if (includePostExit) {
      const recent = trades.slice(0, 10);
      const results = await Promise.all(
        recent.map(async (t) => {
          try {
            const movement = t.assetClass === 'options'
              ? await checkOptionsPostExitMovement(t)
              : await checkEquityPostExitMovement(t);
            return [t.id, movement] as const;
          } catch (err) {
            return [t.id, { status: 'no_data_available', error: String(err) }] as const;
          }
        })
      );
      postExitById = Object.fromEntries(results);
    }

    return NextResponse.json({ success: true, trades, stats, postExitById });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
