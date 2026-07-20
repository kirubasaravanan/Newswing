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
  legCloses: z.array(z.object({
    tradeId: z.string(),
    exitPremium: z.number().positive().optional(),
  })).optional(),
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

// PUT close strategy — closes all open legs, credits P&L to wallet
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

    const result = await db.$transaction(async (tx) => {
      const strategy = await tx.optionStrategy.findUnique({
        where: { id: parsed.data.id },
        include: { trades: true },
      });

      if (!strategy) {
        throw new Error('Strategy not found');
      }

      if (strategy.status === 'CLOSED') {
        throw new Error('Strategy is already closed');
      }

      // Build a map of exit premiums if provided
      const exitPremiumMap = new Map<string, number>();
      if (parsed.data.legCloses) {
        for (const lc of parsed.data.legCloses) {
          if (lc.exitPremium) exitPremiumMap.set(lc.tradeId, lc.exitPremium);
        }
      }

      let totalPnl = 0;
      let totalMarginFreed = 0;

      for (const trade of strategy.trades) {
        if (trade.status !== 'OPEN') {
          // Already closed leg — just add its P&L
          if (trade.pnl) totalPnl += trade.pnl;
          continue;
        }

        // Calculate P&L for this leg
        const exitPrem = exitPremiumMap.get(trade.id) || trade.currentPremium || trade.entryPremium;
        const direction = trade.action === 'BUY' ? 1 : -1;
        const pnl = (exitPrem - trade.entryPremium) * trade.qty * trade.lotSize * direction;
        const roundedPnl = Math.round(pnl * 100) / 100;
        totalPnl += roundedPnl;

        // Close the individual trade
        await tx.optionTrade.update({
          where: { id: trade.id },
          data: {
            status: 'CLOSED',
            exitDate: new Date(),
            exitPremium: parseFloat(String(exitPrem)),
            pnl: roundedPnl,
            pnlPercent: trade.marginUsed && trade.marginUsed > 0
              ? Math.round((roundedPnl / trade.marginUsed) * 10000) / 100
              : 0,
            exitReason: 'STRATEGY_CLOSE',
          },
        });

        // Track margin to free
        totalMarginFreed += trade.marginUsed || 0;
      }

      // Close the strategy
      const updated = await tx.optionStrategy.update({
        where: { id: parsed.data.id },
        data: {
          status: 'CLOSED',
          exitDate: new Date(),
          totalPnl: Math.round(totalPnl * 100) / 100,
        },
        include: { trades: true },
      });

      // Credit P&L and free deployed capital in wallet
      const wallet = await tx.capitalWallet.findFirst();
      if (wallet) {
        const newRealized = Math.round((wallet.realizedPnl + totalPnl) * 100) / 100;
        const newTotal = Math.round((wallet.initialCapital + newRealized) * 100) / 100;
        const newDeployed = Math.max(0, Math.round((wallet.deployed - totalMarginFreed) * 100) / 100);
        const newAvailable = Math.max(0, Math.round((newTotal - newDeployed) * 100) / 100);
        await tx.capitalWallet.update({
          where: { id: wallet.id },
          data: {
            realizedPnl: newRealized,
            totalCapital: newTotal,
            deployed: newDeployed,
            available: newAvailable,
          },
        });
      }

      return updated;
    });

    return NextResponse.json({ success: true, strategy: result });
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === 'Strategy not found' || error.message === 'Strategy is already closed')) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.message === 'Strategy not found' ? 404 : 400 });
    }
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}