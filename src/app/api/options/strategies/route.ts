import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';
import { createStrategy } from '@/services/options.service';

// ── Zod Schemas ───────────────────────────────────────────────

const strategyLegSchema = z.object({
  optionType: z.enum(['CE', 'PE']),
  action: z.enum(['BUY', 'SELL']),
  strikePrice: z.number().positive(),
  entryPremium: z.number().positive(),
  lotSize: z.number().int().positive().optional(),
  qty: z.number().int().positive().optional(),
});

const createStrategySchema = z.object({
  name: z.string().min(1, 'Strategy name required').max(100),
  symbol: z.string().min(1, 'Symbol required'),
  legs: z.array(strategyLegSchema).min(1, 'At least one leg required').max(8, 'Max 8 legs'),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry must be YYYY-MM-DD'),
  notes: z.string().max(500).optional(),
  underlyingPrice: z.number().positive().optional(),
});

const closeStrategySchema = z.object({
  id: z.string().min(1, 'Strategy ID required'),
});

// GET all strategies
export async function GET() {
  try {
    const strategies = await db.optionStrategy.findMany({
      orderBy: { createdAt: 'desc' },
      include: { trades: true },
    });
    return NextResponse.json({ success: true, strategies });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// POST create strategy with legs (delegates to service)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createStrategySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const strategy = await createStrategy(parsed.data);
    return NextResponse.json({ success: true, strategy });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// PUT close strategy
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = closeStrategySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const strategy = await db.optionStrategy.findUnique({
      where: { id: parsed.data.id },
      include: { trades: true },
    });

    if (!strategy) {
      return NextResponse.json({ success: false, error: 'Strategy not found' }, { status: 404 });
    }

    let totalPnl = 0;
    for (const trade of strategy.trades) {
      if (trade.pnl) totalPnl += trade.pnl;
    }

    const updated = await db.optionStrategy.update({
      where: { id: parsed.data.id },
      data: { status: 'CLOSED', exitDate: new Date(), totalPnl },
    });

    return NextResponse.json({ success: true, strategy: updated });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}