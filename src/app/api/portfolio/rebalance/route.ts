import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentPrice } from '@/lib/trading/data-provider';

// GET /api/portfolio/rebalance — suggest trades to reach target allocation
export async function GET() {
  try {
    const openTrades = await db.paperTrade.findMany({ where: { status: 'OPEN' } });
    const [wallet, allStocks] = await Promise.all([
      db.capitalWallet.findFirst(),
      db.watchlistStock.findMany(),
    ]);

    const totalCapital = wallet?.totalCapital || 200000;
    const stockSectorMap = new Map(allStocks.map(s => [s.symbol, s.sector || 'Other']));

    // Fetch live prices
    const symbols = [...new Set(openTrades.map(t => t.symbol))];
    const priceMap: Record<string, number> = {};
    for (const sym of symbols) {
      try {
        const { price } = await getCurrentPrice(sym);
        if (price > 0) priceMap[sym] = price;
      } catch { /* skip */ }
    }

    // Current allocation
    interface Alloc { sector: string; current: number; currentPct: number; targetPct: number; diff: number; value: number; count: number }
    const sectorAlloc = new Map<string, { value: number; count: number }>();
    let totalValue = 0;

    for (const t of openTrades) {
      const price = priceMap[t.symbol] || t.entryPrice;
      const value = price * t.qty;
      totalValue += value;
      const sector = stockSectorMap.get(t.symbol) || 'Other';
      const prev = sectorAlloc.get(sector) || { value: 0, count: 0 };
      prev.value += value;
      prev.count += 1;
      sectorAlloc.set(sector, prev);
    }

    // Target: equal-weight across sectors
    const sectorCount = Math.max(sectorAlloc.size, 1);
    const targetPct = 100 / sectorCount;

    const allocations: Alloc[] = Array.from(sectorAlloc.entries()).map(([sector, data]) => ({
      sector,
      current: Math.round(data.value),
      currentPct: totalValue > 0 ? Math.round((data.value / totalValue) * 1000) / 10 : 0,
      targetPct: Math.round(targetPct * 10) / 10,
      diff: totalValue > 0 ? Math.round(((data.value / totalValue) * 100 - targetPct) * 10) / 10 : 0,
      value: Math.round(data.value),
      count: data.count,
    })).sort((a, b) => b.current - a.current);

    // Suggest rebalance actions (simplified: overweight → reduce, underweight → add)
    const actions: Array<{ type: string; sector: string; amount: number; note: string }> = [];
    for (const alloc of allocations) {
      if (alloc.diff > 10) {
        actions.push({
          type: 'REDUCE', sector: alloc.sector,
          amount: Math.round((alloc.diff / 100) * totalValue),
          note: `${alloc.sector} is ${alloc.diff.toFixed(1)}% overweight. Consider trimming.`,
        });
      } else if (alloc.diff < -10) {
        actions.push({
          type: 'ADD', sector: alloc.sector,
          amount: Math.round((Math.abs(alloc.diff) / 100) * totalValue),
          note: `${alloc.sector} is ${Math.abs(alloc.diff).toFixed(1)}% underweight. Consider adding.`,
        });
      }
    }

    // Per-stock concentration check
    const stockAlloc = openTrades.map(t => {
      const price = priceMap[t.symbol] || t.entryPrice;
      const value = price * t.qty;
      return {
        symbol: t.symbol,
        value: Math.round(value),
        pct: totalValue > 0 ? Math.round((value / totalValue) * 1000) / 10 : 0,
        sector: stockSectorMap.get(t.symbol) || 'Other',
      };
    }).sort((a, b) => b.value - a.value);

    return NextResponse.json({
      success: true,
      rebalance: {
        totalValue: Math.round(totalValue),
        totalCapital,
        cashAvailable: totalCapital - Math.round(totalValue),
        sectorCount,
        allocations,
        actions,
        stockConcentration: stockAlloc,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}