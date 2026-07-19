import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';

const journalSchema = z.object({
  tradeId: z.string().min(1, 'Trade ID required'),
  mood: z.enum(['CONFIDENT', 'NEUTRAL', 'ANXIOUS', 'FOMO', 'GREED', 'FEAR']).optional().default('NEUTRAL'),
  marketContext: z.string().max(500).optional(),
  emotions: z.string().max(300).optional(),
  lessonsLearned: z.string().max(1000).optional(),
  rating: z.number().int().min(1).max(5).optional(),
});

// GET all journal entries
export async function GET() {
  try {
    const entries = await db.tradeJournalEntry.findMany({
      orderBy: { createdAt: 'desc' },
      include: { trade: true },
    });
    return NextResponse.json({ success: true, entries });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// POST create/update journal entry
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = journalSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    // Verify trade exists
    const trade = await db.paperTrade.findUnique({ where: { id: parsed.data.tradeId } });
    if (!trade) {
      return NextResponse.json({ success: false, error: 'Trade not found' }, { status: 404 });
    }

    const entry = await db.tradeJournalEntry.upsert({
      where: { tradeId: parsed.data.tradeId },
      create: {
        tradeId: parsed.data.tradeId,
        mood: parsed.data.mood,
        marketContext: parsed.data.marketContext || null,
        emotions: parsed.data.emotions || null,
        lessonsLearned: parsed.data.lessonsLearned || null,
        rating: parsed.data.rating || null,
      },
      update: {
        mood: parsed.data.mood,
        marketContext: parsed.data.marketContext ?? undefined,
        emotions: parsed.data.emotions ?? undefined,
        lessonsLearned: parsed.data.lessonsLearned ?? undefined,
        rating: parsed.data.rating ?? undefined,
      },
    });

    return NextResponse.json({ success: true, entry });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}