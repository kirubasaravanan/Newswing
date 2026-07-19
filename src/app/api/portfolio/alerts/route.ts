import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentPrice } from '@/lib/trading/data-provider';

// GET /api/portfolio/alerts — list all alerts
export async function GET() {
  try {
    const alerts = await db.priceAlert.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return NextResponse.json({ success: true, alerts });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// POST /api/portfolio/alerts — create alert
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { symbol, condition, targetPrice, notes } = body;
    if (!symbol || !condition || !targetPrice) {
      return NextResponse.json({ success: false, error: 'symbol, condition, targetPrice required' }, { status: 400 });
    }
    const alert = await db.priceAlert.create({
      data: {
        symbol: symbol.toUpperCase(),
        condition, // ABOVE / BELOW
        targetPrice: parseFloat(targetPrice),
        notes: notes || null,
      },
    });
    return NextResponse.json({ success: true, alert });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// DELETE /api/portfolio/alerts?id=xxx
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });
    await db.priceAlert.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// POST /api/portfolio/alerts/check — check alerts against live prices
export async function PUT() {
  try {
    const activeAlerts = await db.priceAlert.findMany({ where: { active: true, triggered: false } });
    if (activeAlerts.length === 0) {
      return NextResponse.json({ success: true, triggered: [] });
    }

    const symbols = [...new Set(activeAlerts.map(a => a.symbol))];
    const priceMap: Record<string, number> = {};
    for (const sym of symbols) {
      try {
        const { price } = await getCurrentPrice(sym);
        if (price > 0) priceMap[sym] = price;
      } catch { /* skip */ }
    }

    const triggered: any[] = [];
    for (const alert of activeAlerts) {
      const price = priceMap[alert.symbol];
      if (!price) continue;

      let isTriggered = false;
      if (alert.condition === 'ABOVE' && price >= alert.targetPrice) isTriggered = true;
      if (alert.condition === 'BELOW' && price <= alert.targetPrice) isTriggered = true;

      if (isTriggered) {
        await db.priceAlert.update({
          where: { id: alert.id },
          data: { triggered: true, triggeredAt: new Date(), triggeredPrice: price },
        });
        triggered.push({ ...alert, currentPrice: price });
      }
    }

    return NextResponse.json({ success: true, triggered });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}