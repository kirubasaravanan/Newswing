import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/portfolio/dividends — list all dividend records
export async function GET() {
  try {
    const dividends = await db.dividendRecord.findMany({ orderBy: { exDate: 'desc' }, take: 100 });
    const totalDividends = dividends.reduce((s, d) => s + d.totalAmount, 0);
    const bySymbol = new Map<string, number>();
    for (const d of dividends) {
      bySymbol.set(d.symbol, (bySymbol.get(d.symbol) || 0) + d.totalAmount);
    }
    const byYear = new Map<string, number>();
    for (const d of dividends) {
      const y = new Date(d.exDate).getFullYear();
      byYear.set(String(y), (byYear.get(String(y)) || 0) + d.totalAmount);
    }

    return NextResponse.json({
      success: true,
      dividends,
      summary: {
        totalDividends: Math.round(totalDividends),
        uniqueStocks: bySymbol.size,
        bySymbol: Object.fromEntries(Array.from(bySymbol.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)),
        byYear: Object.fromEntries(byYear),
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// POST /api/portfolio/dividends — record a dividend
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { symbol, exDate, dividendPerShare, totalAmount, qty, stockName, recordDate, paymentDate, notes } = body;
    if (!symbol || !exDate || !dividendPerShare) {
      return NextResponse.json({ success: false, error: 'symbol, exDate, dividendPerShare required' }, { status: 400 });
    }
    const record = await db.dividendRecord.create({
      data: {
        symbol: symbol.toUpperCase(),
        stockName: stockName || symbol,
        exDate: new Date(exDate),
        dividendPerShare: parseFloat(dividendPerShare),
        totalAmount: parseFloat(totalAmount) || (parseFloat(dividendPerShare) * (parseInt(qty) || 1)),
        qty: qty ? parseInt(qty) : null,
        recordDate: recordDate ? new Date(recordDate) : null,
        paymentDate: paymentDate ? new Date(paymentDate) : null,
        notes: notes || null,
      },
    });
    return NextResponse.json({ success: true, record });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// DELETE /api/portfolio/dividends?id=xxx
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });
    await db.dividendRecord.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}