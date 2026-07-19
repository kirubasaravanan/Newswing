import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';
import { blackScholes, impliedVolatility, calculateGreeksSL, getOptionLotSize, timeToExpiryYears, daysToExpiry as dte, getDividendYield } from '@/lib/options/black-scholes';

// ── Zod Schemas ───────────────────────────────────────────────

const createOptionTradeSchema = z.object({
  symbol: z.string().min(1, 'Symbol is required'),
  optionType: z.enum(['CE', 'PE'], { errorMap: () => ({ message: 'optionType must be CE or PE' }) }),
  action: z.enum(['BUY', 'SELL'], { errorMap: () => ({ message: 'action must be BUY or SELL' }) }),
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

    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = status;
    }

    const trades = await db.optionTrade.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { strategy: true },
    });

    return NextResponse.json({ success: true, trades });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// POST create new option trade
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

    const {
      symbol, optionType, action, strikePrice, expiryDate,
      lotSize, qty, entryPremium,
      stopLoss, takeProfit, notes, tags,
      underlyingPrice, strategyId,
    } = parsed.data;

    // Get spot price
    const spot = underlyingPrice || 0;
    const r = 0.07;
    const T = timeToExpiryYears(expiryDate);
    const d = dte(expiryDate);

    // Calculate Greeks from premium (with dividend yield for stocks)
    let iv: number;
    const q = getDividendYield(symbol);
    try {
      iv = impliedVolatility(spot, strikePrice, T, r, entryPremium, optionType);
    } catch {
      iv = 0.15; // fallback
    }

    const bs = blackScholes(spot, strikePrice, T, r, iv, optionType, q);

    // Auto-calculate SL/TP if not provided
    let sl = stopLoss;
    let tp = takeProfit;
    let slReasoning: string | undefined;
    let tpReasoning: string | undefined;
    let marginUsed: number | undefined;

    if (!sl || !tp) {
      const slResult = calculateGreeksSL({
        entryPremium,
        delta: bs.delta,
        gamma: bs.gamma,
        theta: bs.theta,
        vega: bs.vega,
        iv,
        daysToExpiry: d,
        strike: strikePrice,
        spot,
        action,
        lotSize: lotSize || getOptionLotSize(symbol),
        qty: qty || 1,
        underlyingSymbol: symbol,
        optionType,
      });

      if (!sl) sl = slResult.stopLoss;
      if (!tp) tp = slResult.takeProfit;
      slReasoning = slResult.slReasoning;
      tpReasoning = slResult.tpReasoning;
      marginUsed = slResult.marginEstimate;
    } else {
      // Simple margin estimate
      const totalShares = (lotSize || getOptionLotSize(symbol)) * (qty || 1);
      marginUsed = action === 'BUY'
        ? entryPremium * totalShares
        : entryPremium * totalShares * 3;
    }

    const trade = await db.optionTrade.create({
      data: {
        symbol,
        underlyingPrice: spot,
        optionType,
        action,
        strikePrice: parseFloat(strikePrice),
        expiryDate,
        lotSize: lotSize || getOptionLotSize(symbol),
        qty: qty || 1,
        entryPremium: parseFloat(entryPremium),
        stopLoss: sl ? parseFloat(sl) : null,
        takeProfit: tp ? parseFloat(tp) : null,
        entryDelta: bs.delta,
        entryGamma: bs.gamma,
        entryTheta: bs.theta,
        entryVega: bs.vega,
        entryIV: iv,
        slReasoning,
        tpReasoning,
        marginUsed,
        notes: notes || null,
        tags: tags || null,
        strategyId: strategyId || null,
      },
    });

    return NextResponse.json({ success: true, trade });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// PUT close a trade
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
    const { id, exitPremium, exitReason } = parsed.data;

    const trade = await db.optionTrade.findUnique({ where: { id } });
    if (!trade) {
      return NextResponse.json({ success: false, error: 'Trade not found' }, { status: 404 });
    }

    const exitPrem = exitPremium || trade.currentPremium || trade.entryPremium;
    const direction = trade.action === 'BUY' ? 1 : -1;
    const pnl = (exitPrem - trade.entryPremium) * trade.qty * trade.lotSize * direction;
    const pnlPct = trade.marginUsed && trade.marginUsed > 0
      ? (pnl / trade.marginUsed) * 100
      : 0;

    const updated = await db.optionTrade.update({
      where: { id },
      data: {
        status: exitReason === 'EXPIRED' ? 'EXPIRED' : exitReason === 'SL_HIT' ? 'SL_HIT' : exitReason === 'TP_HIT' ? 'TP_HIT' : 'CLOSED',
        exitDate: new Date(),
        exitPremium: parseFloat(exitPrem),
        pnl: Math.round(pnl * 100) / 100,
        pnlPercent: Math.round(pnlPct * 100) / 100,
        exitReason: exitReason || 'MANUAL',
      },
    });

    return NextResponse.json({ success: true, trade: updated });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// DELETE trade
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, error: 'ID required' }, { status: 400 });
    }
    await db.optionTrade.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}