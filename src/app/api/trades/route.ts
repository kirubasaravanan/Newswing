import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';

// ── Zod Schemas ───────────────────────────────────────────────

const createTradeSchema = z.object({
  symbol: z.string().min(1, 'Symbol is required'),
  stockName: z.string().max(100).optional(),
  direction: z.enum(['LONG', 'SHORT']).default('LONG'),
  entryDate: z.string().optional(),
  entryPrice: z.coerce.number().positive('Entry price must be positive'),
  qty: z.coerce.number().int().positive('Quantity must be positive'),
  stopLoss: z.coerce.number().positive('Stop loss must be positive'),
  targetPrice: z.coerce.number().positive('Target price must be positive'),
  notes: z.string().max(1000).optional(),
  tags: z.string().max(200).optional(),
  autoTraded: z.boolean().optional().default(false),
  exitReason: z.string().optional(),
  portfolioId: z.string().optional(),
});

const closeTradeSchema = z.object({
  id: z.string().min(1, 'Trade ID required'),
  exitDate: z.string().optional(),
  exitPrice: z.coerce.number().positive('Exit price must be positive').optional(),
  status: z.enum(['CLOSED', 'CANCELLED']).optional(),
  exitReason: z.string().max(100).optional(),
});

// GET all paper trades
export async function GET() {
  try {
    const trades = await db.paperTrade.findMany({
      orderBy: { createdAt: 'desc' },
      include: { journal: true },
    });
    return NextResponse.json({ success: true, trades });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// POST create a new paper trade
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createTradeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const trade = await db.paperTrade.create({
      data: {
        symbol: parsed.data.symbol,
        stockName: parsed.data.stockName || null,
        direction: parsed.data.direction,
        entryDate: new Date(parsed.data.entryDate || Date.now()),
        entryPrice: parsed.data.entryPrice,
        qty: parsed.data.qty,
        stopLoss: parsed.data.stopLoss,
        targetPrice: parsed.data.targetPrice,
        notes: parsed.data.notes || null,
        tags: parsed.data.tags || null,
        autoTraded: parsed.data.autoTraded,
        exitReason: parsed.data.exitReason || null,
      },
    });
    return NextResponse.json({ success: true, trade });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// PUT update a trade (close it) — uses Prisma transaction for wallet + trade atomicity
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
    const { id, exitDate, exitPrice, status, exitReason } = parsed.data;

    // Use Prisma transaction for atomic trade close + wallet update
    const result = await db.$transaction(async (tx) => {
      const trade = await tx.paperTrade.findUnique({ where: { id } });
      if (!trade) throw new Error('Trade not found');

      let pnl: number | null = null;
      let pnlPercent: number | null = null;

      if (exitPrice != null) {
        const ep = trade.entryPrice;
        const xp = exitPrice;
        if (trade.direction === 'SHORT') {
          pnl = (ep - xp) * trade.qty;
          pnlPercent = ((ep - xp) / ep) * 100;
        } else {
          pnl = (xp - ep) * trade.qty;
          pnlPercent = ((xp - ep) / ep) * 100;
        }
      }

      const updated = await tx.paperTrade.update({
        where: { id },
        data: {
          exitDate: exitDate ? new Date(exitDate) : undefined,
          exitPrice: exitPrice ?? undefined,
          pnl,
          pnlPercent,
          status: status || 'CLOSED',
          exitReason: exitReason || 'MANUAL',
        },
      });

      // Update wallet atomically in same transaction
      if (pnl != null && (status === 'CLOSED' || !status)) {
        const wallet = await tx.capitalWallet.findFirst();
        if (wallet) {
          const newRealizedPnl = Math.round((wallet.realizedPnl + pnl) * 100) / 100;
          await tx.capitalWallet.update({
            where: { id: wallet.id },
            data: { realizedPnl: newRealizedPnl },
          });
        }
      }

      return updated;
    });

    return NextResponse.json({ success: true, trade: result });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Trade not found') {
      return NextResponse.json({ success: false, error: 'Trade not found' }, { status: 404 });
    }
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// DELETE a trade
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'ID required' }, { status: 400 });

    // Delete journal entry first
    await db.tradeJournalEntry.deleteMany({ where: { tradeId: id } });
    await db.paperTrade.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}