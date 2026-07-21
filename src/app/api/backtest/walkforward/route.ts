/**
 * Walk-Forward Analysis API
 * Runs rolling window backtests to validate strategy stability over time.
 * Tests consistency of Sharpe, Win Rate, and Profit Factor across
 * multiple non-overlapping windows.
 */
import { NextRequest, NextResponse } from 'next/server';
import { runBacktest, DEFAULT_CONFIG, type ScreeningConfig } from '@/lib/trading/screening-engine';
import { getHistoricalData } from '@/lib/trading/data-provider';

interface WindowResult {
  windowIndex: number;
  startDate: string;
  endDate: string;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  finalCapital: number;
  cagr: number;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const symbol: string = body.symbol;
    const config: ScreeningConfig = { ...DEFAULT_CONFIG, ...body.config };
    const totalDays = body.totalDays || 500;
    const windowDays = body.windowDays || 120;
    const stepDays = body.stepDays || 60; // rolling step

    if (!symbol) {
      return NextResponse.json({ success: false, error: 'Symbol is required' }, { status: 400 });
    }

    // Fetch full history
    const [stockRes, niftyRes] = await Promise.all([
      getHistoricalData(symbol, totalDays + 50),
      getHistoricalData('NIFTY50', totalDays + 50),
    ]);

    if (!stockRes.data || stockRes.data.length < 300) {
      return NextResponse.json({
        success: false,
        error: `Insufficient data for ${symbol}: ${stockRes.data?.length || 0} candles (need 300+)`,
      }, { status: 400 });
    }

    const allCandles = stockRes.data;
    const niftyCandles = niftyRes.data;
    const windows: WindowResult[] = [];

    // Run rolling windows
    const startOffset = allCandles.length - totalDays;
    for (let wStart = Math.max(0, startOffset); wStart + windowDays <= allCandles.length; wStart += stepDays) {
      const wEnd = Math.min(wStart + windowDays, allCandles.length);
      const windowCandles = allCandles.slice(wStart, wEnd);

      if (windowCandles.length < 200) continue;

      // Align nifty candles to same date range
      const wStartDate = windowCandles[0].date;
      const niftyStart = niftyCandles.findIndex(c => c.date >= wStartDate);
      const niftyWindow = niftyStart >= 0 ? niftyCandles.slice(niftyStart) : niftyCandles;

      try {
        const result = runBacktest(symbol, windowCandles, niftyWindow, config);
        const initialCapital = config.liveCapital;
        const finalCapital = result.stats.finalCapital;
        const tradingDays = Math.max(result.stats.totalTrades * 3, 40);
        const cagr = ((finalCapital / initialCapital) ** (252 / tradingDays) - 1) * 100;

        windows.push({
          windowIndex: windows.length + 1,
          startDate: windowCandles[0].date,
          endDate: windowCandles[windowCandles.length - 1].date,
          totalTrades: result.stats.totalTrades,
          winRate: result.stats.winRate,
          profitFactor: result.stats.profitFactor,
          sharpeRatio: result.stats.sharpeRatio,
          maxDrawdown: result.stats.maxDrawdown,
          finalCapital: result.stats.finalCapital,
          cagr: Math.round(cagr * 100) / 100,
        });
      } catch (err) {
        console.error(`Window ${windows.length + 1} failed:`, err);
        windows.push({
          windowIndex: windows.length + 1,
          startDate: windowCandles[0].date,
          endDate: windowCandles[windowCandles.length - 1].date,
          totalTrades: 0, winRate: 0, profitFactor: 0, sharpeRatio: 0,
          maxDrawdown: 0, finalCapital: config.liveCapital, cagr: 0,
        });
      }

      // Safety timeout
      if (Date.now() - startTime > 4 * 60 * 1000) break;
    }

    if (windows.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid windows produced results' }, { status: 500 });
    }

    // Compute consistency metrics
    const profitableWindows = windows.filter(w => w.finalCapital > config.liveCapital);
    const winRates = windows.map(w => w.winRate);
    const sharpes = windows.map(w => w.sharpeRatio);
    const pfs = windows.map(w => w.profitFactor);
    const cagrs = windows.map(w => w.cagr);

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const stdDev = (arr: number[]) => {
      const m = avg(arr);
      return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
    };

    const avgWR = avg(winRates);
    const avgSharpe = avg(sharpes);
    const avgPF = avg(pfs);
    const avgCAGR = avg(cagrs);
    const stdWR = stdDev(winRates);
    const stdSharpe = stdDev(sharpes);

    // Consistency score: 0-100 based on how many windows are profitable and how low the variance is
    const profitConsistency = (profitableWindows.length / windows.length) * 100;
    const wrStability = avgWR > 0 ? Math.max(0, 100 - (stdWR / avgWR) * 100) : 0;
    const sharpeStability = avgSharpe > 0 ? Math.max(0, 100 - (stdSharpe / Math.abs(avgSharpe)) * 100) : 0;
    const consistencyScore = Math.round(
      profitConsistency * 0.4 + wrStability * 0.3 + sharpeStability * 0.3
    );

    // Rolling metrics (window-to-window changes)
    const rollingMetrics = windows.slice(1).map((w, i) => ({
      window: w.windowIndex,
      prevWindow: windows[i].windowIndex,
      wrChange: Math.round((w.winRate - windows[i].winRate) * 100) / 100,
      sharpeChange: Math.round((w.sharpeRatio - windows[i].sharpeRatio) * 100) / 100,
      pfChange: Math.round((w.profitFactor - windows[i].profitFactor) * 100) / 100,
    }));

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    return NextResponse.json({
      success: true,
      symbol,
      meta: {
        totalWindows: windows.length,
        windowDays,
        stepDays,
        elapsedSec: elapsed,
      },
      summary: {
        avgWinRate: Math.round(avgWR * 100) / 100,
        avgSharpe: Math.round(avgSharpe * 100) / 100,
        avgProfitFactor: Math.round(avgPF * 100) / 100,
        avgCAGR: Math.round(avgCAGR * 100) / 100,
        stdWinRate: Math.round(stdWR * 100) / 100,
        stdSharpe: Math.round(stdSharpe * 100) / 100,
        profitableWindows: profitableWindows.length,
        consistencyScore,
        // Strategy passes if consistency > 60 and avgSharpe > 0.5
        pass: consistencyScore >= 60 && avgSharpe >= 0.5,
      },
      windows,
      rollingMetrics,
    });
  } catch (error) {
    console.error('Walk-forward error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}