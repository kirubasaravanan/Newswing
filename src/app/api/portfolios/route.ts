import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/portfolios — list all portfolios
export async function GET() {
  try {
    const portfolios = await db.portfolio.findMany({ orderBy: { createdAt: 'asc' } });
    // Add trade counts
    const withCounts = await Promise.all(portfolios.map(async p => {
      const count = await db.paperTrade.count({ where: { portfolioId: p.id, status: 'OPEN' } });
      return { ...p, openPositions: count };
    }));
    return NextResponse.json({ success: true, portfolios: withCounts });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// POST /api/portfolios — create portfolio
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const portfolio = await db.portfolio.create({
      data: {
        name: body.name || 'New Portfolio',
        description: body.description || null,
        totalCapital: body.totalCapital || 200000,
        isDefault: body.isDefault || false,
      },
    });
    return NextResponse.json({ success: true, portfolio });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// DELETE /api/portfolios?id=xxx
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });
    // Unlink trades first
    await db.paperTrade.updateMany({ where: { portfolioId: id }, data: { portfolioId: null } });
    await db.portfolio.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}