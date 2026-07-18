import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET all journal entries
export async function GET() {
  try {
    const entries = await db.tradeJournalEntry.findMany({
      orderBy: { createdAt: 'desc' },
      include: { trade: true },
    });
    return NextResponse.json({ success: true, entries });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// POST create/update journal entry
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tradeId, mood, marketContext, emotions, lessonsLearned, rating } = body;

    // Verify trade exists
    const trade = await db.paperTrade.findUnique({ where: { id: tradeId } });
    if (!trade) {
      return NextResponse.json({ success: false, error: 'Trade not found' }, { status: 404 });
    }

    const entry = await db.tradeJournalEntry.upsert({
      where: { tradeId },
      create: {
        tradeId,
        mood: mood || 'NEUTRAL',
        marketContext: marketContext || null,
        emotions: emotions || null,
        lessonsLearned: lessonsLearned || null,
        rating: rating || null,
      },
      update: {
        mood: mood || undefined,
        marketContext: marketContext || undefined,
        emotions: emotions || undefined,
        lessonsLearned: lessonsLearned || undefined,
        rating: rating || undefined,
      },
    });

    return NextResponse.json({ success: true, entry });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}