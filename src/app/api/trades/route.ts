import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';
import { calculateEquityCosts } from '@/lib/trading/transaction-costs';

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

      let grossPnl: number | null = null;
      let netPnl: number | null = null;
      let totalCosts: number | null = null;
      let pnlPercent: number | null = null;

      let costs: ReturnType<typeof calculateEquityCosts> | null = null;

      if (exitPrice != null) {
        const ep = trade.entryPrice;
        const xp = exitPrice;
        const qty = trade.qty;
        costs = calculateEquityCosts(ep, xp, qty, trade.symbol);
        
        grossPnl = trade.direction === 'SHORT' ? (ep - xp) * qty : (xp - ep) * qty;
        totalCosts = costs.totalCosts;
        netPnl = grossPnl - totalCosts;
        pnlPercent = ((xp - ep) / ep) * 100;
      }

      const updated = await tx.paperTrade.update({
        where: { id },
        data: {
          exitDate: exitDate ? new Date(exitDate) : undefined,
          exitPrice: exitPrice ?? undefined,
          pnl: netPnl != null ? Math.round(netPnl * 100) / 100 : undefined,
          pnlPercent: pnlPercent != null ? Math.round(pnlPercent * 100) / 100 : undefined,
          grossPnl: grossPnl != null ? Math.round(grossPnl * 100) / 100 : undefined,
          netPnl: netPnl != null ? Math.round(netPnl * 100) / 100 : undefined,
          totalCosts: totalCosts != null ? Math.round(totalCosts * 100) / 100 : undefined,
          brokerageCost: costs ? Math.round(costs.brokerage * 100) / 100 : undefined,
          sttCost: costs ? Math.round(costs.stt * 100) / 100 : undefined,
          slippageCost: costs ? Math.round(costs.slippage * 100) / 100 : undefined,
          otherCharges: costs ? Math.round((costs.exchangeCharges + costs.gst + costs.sebiFees + costs.stampDuty) * 100) / 100 : undefined,
          status: status || 'CLOSED',
          exitReason: exitReason || 'MANUAL',
        },
      });

      // Update wallet atomically in same transaction with netPnl
      if (netPnl != null && (status === 'CLOSED' || !status)) {
        const wallet = await tx.capitalWallet.findFirst();
        if (wallet) {
          const newRealizedPnl = Math.round((wallet.realizedPnl + netPnl) * 100) / 100;
          const newCostsPaid = Math.round(((wallet.totalCostsPaid || 0) + (totalCosts || 0)) * 100) / 100;
          await tx.capitalWallet.update({
            where: { id: wallet.id },
            data: { realizedPnl: newRealizedPnl, totalCostsPaid: newCostsPaid },
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