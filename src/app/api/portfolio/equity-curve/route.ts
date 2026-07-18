import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentPrice } from '@/lib/trading/data-provider';

// GET /api/portfolio/equity-curve?days=90
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '90');

    // Take a fresh snapshot first
    await takeSnapshot();

    const snapshots = await db.dailySnapshot.findMany({ orderBy: { date: 'asc' } });

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    const filtered = snapshots.filter(s => s.date >= cutoffStr);

    const chartData = filtered.map(s => ({
      date: s.date,
      nav: Math.round(s.nav),
      dailyReturn: Math.round(s.dailyReturn * 100) / 100,
      dailyPnl: Math.round(s.dailyPnl),
      drawdown: 0,
    }));

    let peak = 0;
    for (const point of chartData) {
      peak = Math.max(peak, point.nav);
      point.drawdown = peak > 0 ? Math.round(((peak - point.nav) / peak) * 10000) / 100 : 0;
    }

    const latest = filtered[filtered.length - 1];
    const first = filtered[0];
    const totalReturn = first && latest ? ((latest.nav - first.nav) / first.nav) * 100 : 0;
    const maxDD = Math.max(...chartData.map(c => c.drawdown), 0);
    const positiveDays = chartData.filter(c => c.dailyPnl > 0).length;
    const negativeDays = chartData.filter(c => c.dailyPnl < 0).length;

    return NextResponse.json({
      success: true, chartData,
      summary: {
        totalReturn: Math.round(totalReturn * 100) / 100,
        maxDD,
        currentNAV: latest?.nav || 0,
        snapshots: filtered.length,
        positiveDays,
        negativeDays,
        bestDay: chartData.length > 0 ? Math.max(...chartData.map(c => c.dailyPnl)) : 0,
        worstDay: chartData.length > 0 ? Math.min(...chartData.map(c => c.dailyPnl)) : 0,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body.action === 'snapshot') {
      const snap = await takeSnapshot();
      return NextResponse.json({ success: true, snapshot: snap });
    }
    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

async function takeSnapshot() {
  const today = new Date().toISOString().split('T')[0];
  let totalCapital = 200000, realizedPnl = 0, deployed = 0;
  try {
    const w = await db.capitalWallet.findFirst();
    if (w) { totalCapital = w.totalCapital; realizedPnl = w.realizedPnl; deployed = w.deployed; }
  } catch { /* use defaults */ }

  let unrealizedPnl = 0;
  let openPositions = 0;
  try {
    const open = await db.paperTrade.findMany({ where: { status: 'OPEN' } });
    openPositions = open.length;
    const syms = [...new Set(open.map(t => t.symbol))];
    for (const sym of syms) {
      try {
        const { price } = await getCurrentPrice(sym);
        for (const t of open.filter(t => t.symbol === sym)) {
          unrealizedPnl += (price - t.entryPrice) * t.qty;
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  const nav = totalCapital + unrealizedPnl;
  const prev = await db.dailySnapshot.findFirst({
    orderBy: { date: 'desc' }, where: { date: { not: today } },
  });
  const dailyPnl = prev ? nav - prev.nav : 0;
  const dailyReturn = prev && prev.nav > 0 ? ((nav - prev.nav) / prev.nav) * 100 : 0;

  return db.dailySnapshot.upsert({
    where: { date: today },
    create: { date: today, nav, realizedPnl, unrealizedPnl, totalCapital, deployed, openPositions, dailyPnl, dailyReturn },
    update: { nav, realizedPnl, unrealizedPnl, totalCapital, deployed, openPositions, dailyPnl, dailyReturn },
  });
}