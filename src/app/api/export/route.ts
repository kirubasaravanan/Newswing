import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const trades = await db.paperTrade.findMany({
      orderBy: { createdAt: 'desc' },
      include: { journal: true },
    });

    if (trades.length === 0) {
      return NextResponse.json({ success: false, error: 'No trades to export' });
    }

    const headers = [
      'Symbol', 'Direction', 'Entry Date', 'Entry Price', 'Quantity',
      'Stop Loss', 'Target Price', 'Status', 'Exit Date', 'Exit Price',
      'P&L (INR)', 'P&L %', 'Tags', 'Notes',
      'Journal Mood', 'Journal Rating', 'Lessons Learned'
    ];

    const rows = trades.map(t => [
      t.symbol,
      t.direction,
      t.entryDate.toISOString().split('T')[0],
      t.entryPrice,
      t.qty,
      t.stopLoss,
      t.targetPrice,
      t.status,
      t.exitDate?.toISOString().split('T')[0] || '',
      t.exitPrice || '',
      t.pnl?.toFixed(2) || '',
      t.pnlPercent?.toFixed(2) || '',
      t.tags || '',
      (t.notes || '').replace(/,/g, ';'),
      t.journal?.mood || '',
      t.journal?.rating || '',
      (t.journal?.lessonsLearned || '').replace(/,/g, ';'),
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="v-swing-journal-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}