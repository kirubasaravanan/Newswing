import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/portfolio/capital-gains — STCG/LTCG report for Indian tax
// STCG: holding < 12 months, taxed at 20%
// LTCG: holding >= 12 months, taxed at 12.5% (above ₹1.25L exemption)
export async function GET() {
  try {
    const trades = await db.paperTrade.findMany({
      where: { status: 'CLOSED', pnl: { not: null }, exitDate: { not: null }, exitPrice: { not: null } },
      orderBy: { exitDate: 'desc' },
    });

    const stcg: any[] = [];
    const ltcg: any[] = [];
    let totalSTCG = 0, totalLTCG = 0;

    const finYearMap = new Map<string, { stcg: number; ltcg: number }>();

    for (const t of trades) {
      if (!t.exitDate || t.pnl == null) continue;
      const holdingDays = (new Date(t.exitDate).getTime() - new Date(t.entryDate).getTime()) / 86400000;
      const isLTCG = holdingDays >= 365;

      const entry = {
        id: t.id, symbol: t.symbol, direction: t.direction,
        entryDate: t.entryDate, exitDate: t.exitDate,
        entryPrice: t.entryPrice, exitPrice: t.exitPrice,
        qty: t.qty, pnl: t.pnl, pnlPercent: t.pnlPercent,
        holdingDays: Math.round(holdingDays),
      };

      // Financial year
      const exit = new Date(t.exitDate);
      const fy = exit.getMonth() >= 3 ? `${exit.getFullYear()}-${exit.getFullYear() + 1}` : `${exit.getFullYear() - 1}-${exit.getFullYear()}`;
      if (!finYearMap.has(fy)) finYearMap.set(fy, { stcg: 0, ltcg: 0 });
      const fyData = finYearMap.get(fy)!;

      if (isLTCG) {
        ltcg.push(entry);
        totalLTCG += t.pnl;
        fyData.ltcg += t.pnl;
      } else {
        stcg.push(entry);
        totalSTCG += t.pnl;
        fyData.stcg += t.pnl;
      }
    }

    // Tax calculation (FY 2024-25 rules)
    const ltcgExemption = 125000;
    const taxableLTCG = Math.max(totalLTCG - ltcgExemption, 0);
    const stcgTax = totalSTCG > 0 ? totalSTCG * 0.20 : 0;
    const ltcgTax = taxableLTCG * 0.125;
    const totalTax = stcgTax + ltcgTax;

    const byFinancialYear = Array.from(finYearMap.entries()).map(([fy, v]) => ({
      fy, stcg: Math.round(v.stcg), ltcg: Math.round(v.ltcg),
      stcgTax: Math.round(Math.max(v.stcg, 0) * 0.20),
      ltcgTax: Math.round(Math.max(v.ltcg - ltcgExemption, 0) * 0.125),
    })).sort((a, b) => b.fy.localeCompare(a.fy));

    return NextResponse.json({
      success: true,
      summary: {
        totalSTCG: Math.round(totalSTCG),
        totalLTCG: Math.round(totalLTCG),
        stcgTax: Math.round(stcgTax),
        ltcgTax: Math.round(ltcgTax),
        totalTax: Math.round(totalTax),
        stcgRate: '20%',
        ltcgRate: '12.5%',
        ltcgExemption: 125000,
      },
      stcg, ltcg, byFinancialYear,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}