import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

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
    const trade = await db.paperTrade.create({
      data: {
        symbol: body.symbol,
        stockName: body.stockName || null,
        direction: body.direction || 'LONG',
        entryDate: new Date(body.entryDate),
        entryPrice: parseFloat(body.entryPrice),
        qty: parseInt(body.qty),
        stopLoss: parseFloat(body.stopLoss),
        targetPrice: parseFloat(body.targetPrice),
        notes: body.notes || null,
        tags: body.tags || null,
      },
    });
    return NextResponse.json({ success: true, trade });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// PUT update a trade (close it)
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, exitDate, exitPrice, status } = body;
    
    const trade = await db.paperTrade.findUnique({ where: { id } });
    if (!trade) {
      return NextResponse.json({ success: false, error: 'Trade not found' }, { status: 404 });
    }

    const pnl = exitPrice ? (exitPrice - trade.entryPrice) * trade.qty : null;
    const pnlPercent = exitPrice ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100 : null;

    const updated = await db.paperTrade.update({
      where: { id },
      data: {
        exitDate: exitDate ? new Date(exitDate) : undefined,
        exitPrice: exitPrice ? parseFloat(exitPrice) : undefined,
        pnl,
        pnlPercent,
        status: status || 'CLOSED',
      },
    });
    return NextResponse.json({ success: true, trade: updated });
  } catch (error) {
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