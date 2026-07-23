/**
 * Universe Scan API - Two-stage screening
 * L1 pre-filter (fast) → L2 V-Swing engine (deep)
 */
import { NextRequest, NextResponse } from 'next/server';
import { runScreening, DEFAULT_CONFIG, type ScreeningConfig } from '@/lib/trading/screening-engine';
import { getHistoricalData, getDataProviderStatus, type DataSource } from '@/lib/trading/data-provider';
import { getFullUniverse, runL1Filter, type L1FilterResult, type NSEStock } from '@/lib/trading/universe-scanner';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const scans = await db.universeScan.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
    let wallet = await db.capitalWallet.findFirst();
    if (!wallet) {
      wallet = await db.capitalWallet.create({ data: { totalCapital: 200000, available: 200000, deployed: 0 } });
    }
    return NextResponse.json({
      success: true,
      scans,
      dataProvider: getDataProviderStatus(),
      wallet: {
        totalCapital: wallet.totalCapital,
        deployed: wallet.deployed,
        available: wallet.available,
        realizedPnl: wallet.realizedPnl,
        unrealizedPnl: wallet.unrealizedPnl,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const body = await request.json();
    const mode: 'l1' | 'full' | 'watchlist' = body.mode || 'full';
    const config: ScreeningConfig = { ...DEFAULT_CONFIG, ...body.config };
    const days = body.days || 300;

    let stocks: NSEStock[] = [];
    if (mode === 'watchlist') {
      const wl = await db.watchlistStock.findMany({ orderBy: { symbol: 'asc' } });
      stocks = wl.map(s => ({ symbol: s.symbol, name: s.name, sector: s.sector || 'Unknown', category: 'FNO' as const }));
    } else {
      stocks = getFullUniverse();
    }

    const totalScanned = stocks.length;
    const l1Results: L1FilterResult[] = [];
    const l2Signals: any[] = [];
    let fetchSource: DataSource = 'yahoo';
    const BATCH = 10;

    // Stage 1: L1 Pre-Filter
    for (let i = 0; i < stocks.length; i += BATCH) {
      const batch = stocks.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(async (stock) => {
          const { data } = await getHistoricalData(stock.symbol, days);
          return { stock, data };
        })
      );
      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        const l1 = runL1Filter(r.value.stock.symbol, r.value.stock.name, r.value.stock.sector, r.value.stock.category, r.value.data);
        if (l1) l1Results.push(l1);
      }
    }

    const l1Passed = l1Results.filter(r => r.passed).length;

    // Stage 2: L2 V-Swing (only L1 passes)
    if (mode !== 'l1' && l1Passed > 0) {
      const passed = l1Results.filter(r => r.passed);
      const { data: niftyData } = await getHistoricalData('NIFTY50', days + 50);

      for (let i = 0; i < passed.length; i += 5) {
        const batch = passed.slice(i, i + 5);
        const results = await Promise.allSettled(
          batch.map(async (stock) => {
            const { data } = await getHistoricalData(stock.symbol, days + 50);
            return { stock, data };
          })
        );
        const isNiftyBullish = niftyData && niftyData.length >= 50 ? niftyData[niftyData.length - 1].close >= niftyData[niftyData.length - 50].close : true;
        for (const r of results) {
          if (r.status !== 'fulfilled') continue;
          const signal = runScreening(r.value.stock.symbol, r.value.data, config, isNiftyBullish);
          if (signal) l2Signals.push(signal);
        }
      }
    }

    l2Signals.sort((a, b) => b.score - a.score || b.riskReward - a.riskReward);

    const duration = (Date.now() - startTime) / 1000;
    await db.universeScan.create({
      data: {
        scanType: mode === 'l1' ? 'L1' : 'FULL',
        totalScanned, l1Passed, l2Signals: l2Signals.length,
        dataSource: fetchSource, duration,
        results: JSON.stringify({ l1: l1Results.slice(0, 200), l2: l2Signals }),
      },
    });

    return NextResponse.json({
      success: true,
      summary: { totalScanned, l1Passed, l1Failed: totalScanned - l1Passed, l2Signals: l2Signals.length, dataSource: fetchSource, duration: duration.toFixed(1) + 's' },
      l1Results: l1Results.filter(r => r.passed),
      l1Failed: l1Results.filter(r => !r.passed).slice(0, 50),
      l2Signals,
    });
  } catch (error) {
    console.error('Universe scan error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}