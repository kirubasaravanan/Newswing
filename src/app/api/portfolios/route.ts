import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';

const createPortfolioSchema = z.object({
  name: z.string().min(1, 'Name required').max(100),
  description: z.string().max(500).optional(),
  totalCapital: z.number().positive().optional().default(200000),
  isDefault: z.boolean().optional().default(false),
});

// GET /api/portfolios
export async function GET() {
  try {
    const portfolios = await db.portfolio.findMany({ orderBy: { createdAt: 'asc' } });
    const withCounts = await Promise.all(portfolios.map(async p => {
      const count = await db.paperTrade.count({ where: { portfolioId: p.id, status: 'OPEN' } });
      return { ...p, openPositions: count };
    }));
    return NextResponse.json({ success: true, portfolios: withCounts });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// POST /api/portfolios
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createPortfolioSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const portfolio = await db.portfolio.create({ data: parsed.data });
    return NextResponse.json({ success: true, portfolio });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// DELETE /api/portfolios?id=xxx
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });
    await db.paperTrade.updateMany({ where: { portfolioId: id }, data: { portfolioId: null } });
    await db.portfolio.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}