import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentPrice } from '@/lib/trading/data-provider';

// GET /api/portfolio/sip — list all SIP plans
export async function GET() {
  try {
    const plans = await db.sIPPlan.findMany({
      where: { active: true },
      orderBy: { nextDate: 'asc' },
    });
    const enriched = await Promise.all(plans.map(async p => {
      let currentPrice = 0;
      try { const r = await getCurrentPrice(p.symbol); currentPrice = r.price; } catch { /* skip */ }
      return {
        ...p,
        currentPrice,
        currentValue: p.totalQty > 0 ? p.totalQty * currentPrice : 0,
        avgPrice: p.totalQty > 0 ? p.totalInvested / p.totalQty : 0,
        returnPct: p.totalInvested > 0 && p.totalQty > 0 ? ((p.totalQty * currentPrice - p.totalInvested) / p.totalInvested * 100) : 0,
      };
    }));
    const totalInvested = enriched.reduce((s, p) => s + p.totalInvested, 0);
    const totalCurrentValue = enriched.reduce((s, p) => s + p.currentValue, 0);
    return NextResponse.json({ success: true, plans: enriched, totalInvested, totalCurrentValue });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// POST /api/portfolio/sip — create SIP plan
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { symbol, amount, frequency, nextDate, stockName, portfolioId } = body;
    if (!symbol || !amount || !nextDate) {
      return NextResponse.json({ success: false, error: 'symbol, amount, nextDate required' }, { status: 400 });
    }
    const plan = await db.sIPPlan.create({
      data: {
        symbol: symbol.toUpperCase(),
        stockName: stockName || symbol,
        amount: parseFloat(amount),
        frequency: frequency || 'MONTHLY',
        nextDate: new Date(nextDate),
        portfolioId: portfolioId || null,
      },
    });
    return NextResponse.json({ success: true, plan });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// DELETE /api/portfolio/sip?id=xxx
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });
    await db.sIPPlan.update({ where: { id }, data: { active: false } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}