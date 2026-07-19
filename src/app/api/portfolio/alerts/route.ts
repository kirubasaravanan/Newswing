import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';
import { getCurrentPrice } from '@/lib/trading/data-provider';

const createAlertSchema = z.object({
  symbol: z.string().min(1).max(20),
  condition: z.enum(['ABOVE', 'BELOW']),
  targetPrice: z.coerce.number().positive('Target price must be positive'),
  notes: z.string().max(200).optional(),
});

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
    const parsed = createAlertSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const alert = await db.priceAlert.create({
      data: {
        symbol: parsed.data.symbol.toUpperCase(),
        condition: parsed.data.condition,
        targetPrice: parsed.data.targetPrice,
        notes: parsed.data.notes || null,
      },
    });
    return NextResponse.json({ success: true, alert });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
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

    const triggered: Array<{ id: string; symbol: string; condition: string; targetPrice: number; currentPrice: number; notes: string | null }> = [];
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
        triggered.push({ id: alert.id, symbol: alert.symbol, condition: alert.condition, targetPrice: alert.targetPrice, currentPrice: price, notes: alert.notes });
      }
    }

    return NextResponse.json({ success: true, triggered });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}