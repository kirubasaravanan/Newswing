import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';
import { createOptionTrade, closeOptionTrade } from '@/services/options.service';

// ── Zod Schemas ───────────────────────────────────────────────

const createOptionTradeSchema = z.object({
  symbol: z.string().min(1, 'Symbol is required'),
  optionType: z.enum(['CE', 'PE'], { message: 'optionType must be CE or PE' }),
  action: z.enum(['BUY', 'SELL'], { message: 'action must be BUY or SELL' }),
  strikePrice: z.coerce.number().positive('Strike must be positive'),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry must be YYYY-MM-DD'),
  lotSize: z.coerce.number().int().positive().optional(),
  qty: z.coerce.number().int().positive().optional().default(1),
  entryPremium: z.coerce.number().positive('Entry premium must be positive'),
  stopLoss: z.coerce.number().positive().optional(),
  takeProfit: z.coerce.number().positive().optional(),
  notes: z.string().max(500).optional(),
  tags: z.string().max(200).optional(),
  underlyingPrice: z.coerce.number().positive().optional(),
  strategyId: z.string().optional(),
});

const closeTradeSchema = z.object({
  id: z.string().min(1, 'Trade ID is required'),
  exitPremium: z.coerce.number().positive().optional(),
  exitReason: z.enum(['MANUAL', 'SL_HIT', 'TP_HIT', 'EXPIRED', 'THETA_DECAY']).optional(),
});

// GET all option trades
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    const where: Record<string, string> = {};
    if (status && status !== 'ALL') {
      where.status = status;
    }

    const trades = await db.optionTrade.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { strategy: true },
    });

    return NextResponse.json({ success: true, trades });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// POST create new option trade (delegates to service)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createOptionTradeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const trade = await createOptionTrade(parsed.data);
    return NextResponse.json({ success: true, trade });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// PUT close a trade (delegates to service with transaction)
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = closeTradeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const updated = await closeOptionTrade(parsed.data);
    return NextResponse.json({ success: true, trade: updated });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Trade not found') {
      return NextResponse.json({ success: false, error: 'Trade not found' }, { status: 404 });
    }
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// DELETE trade — frees deployed capital if trade was OPEN
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, error: 'ID required' }, { status: 400 });
    }

    await db.$transaction(async (tx) => {
      const trade = await tx.optionTrade.findUnique({ where: { id } });
      if (!trade) throw new Error('Trade not found');

      // If trade was OPEN, free up deployed capital from wallet
      if (trade.status === 'OPEN' && trade.marginUsed) {
        const wallet = await tx.capitalWallet.findFirst();
        if (wallet) {
          const newDeployed = Math.max(0, Math.round((wallet.deployed - trade.marginUsed) * 100) / 100);
          const newAvailable = Math.max(0, Math.round((wallet.totalCapital - newDeployed) * 100) / 100);
          await tx.capitalWallet.update({
            where: { id: wallet.id },
            data: { deployed: newDeployed, available: newAvailable },
          });
        }
      }

      await tx.optionTrade.delete({ where: { id } });
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Trade not found') {
      return NextResponse.json({ success: false, error: 'Trade not found' }, { status: 404 });
    }
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}