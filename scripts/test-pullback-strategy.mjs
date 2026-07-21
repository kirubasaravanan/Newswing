import { SMA, EMA, RSI, ATR, ADX } from 'technicalindicators';

const TOP_STOCKS = [
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
  'SBIN', 'BHARTIARTL', 'ITC', 'KOTAKBANK', 'LT',
  'AXISBANK', 'BAJFINANCE', 'TATAMOTORS', 'MARUTI', 'SUNPHARMA',
  'WIPRO', 'HCLTECH', 'TATASTEEL', 'TITAN', 'POWERGRID',
];

async function fetchCandles(symbol, days = 500) {
  const end = Math.floor(Date.now() / 1000);
  const start = Math.floor((Date.now() - days * 1.5 * 86400000) / 1000);
  const sym = symbol === 'NIFTY50' ? '^NSEI' : `${symbol}.NS`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${start}&period2=${end}&interval=1d`;
  
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return [];
  const json = await res.json();
  const r = json.chart?.result?.[0];
  if (!r || !r.timestamp) return [];
  
  const q = r.indicators?.quote?.[0];
  const candles = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    if (q.open?.[i] != null && q.high?.[i] != null && q.low?.[i] != null && q.close?.[i] != null) {
      candles.push({
        date: new Date(r.timestamp[i] * 1000).toISOString().split('T')[0],
        open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume?.[i] || 0,
      });
    }
  }
  return candles;
}

function runPullbackBacktest(candles, niftyCandles) {
  if (candles.length < 200) return null;

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  const ema20 = EMA.calculate({ period: 20, values: closes });
  const sma50 = SMA.calculate({ period: 50, values: closes });
  const sma200 = SMA.calculate({ period: 200, values: closes });
  const rsi14 = RSI.calculate({ period: 14, values: closes });
  const atr14 = ATR.calculate({ period: 14, high: highs, low: lows, close: closes });
  const adx14 = ADX.calculate({ period: 14, high: highs, low: lows, close: closes });

  const niftyCloses = niftyCandles.map(c => c.close);
  const niftySma200 = SMA.calculate({ period: 200, values: niftyCloses });
  const offsetNifty200 = niftyCandles.length - niftySma200.length;

  const offsetEMA20 = candles.length - ema20.length;
  const offsetSMA50 = candles.length - sma50.length;
  const offsetSMA200 = candles.length - sma200.length;
  const offsetRSI = candles.length - rsi14.length;
  const offsetATR = candles.length - atr14.length;
  const offsetADX = candles.length - adx14.length;

  let capital = 200000;
  const initialCapital = 200000;
  let trades = [];
  let openPosition = null;

  for (let i = 200; i < candles.length; i++) {
    const bar = candles[i];
    const e20 = ema20[i - offsetEMA20];
    const s50 = sma50[i - offsetSMA50];
    const s200 = sma200[i - offsetSMA200];
    const rsi = rsi14[i - offsetRSI];
    const prevRsi = rsi14[i - 1 - offsetRSI];
    const atr = atr14[i - offsetATR];
    const adxObj = adx14[i - offsetADX];
    const adx = adxObj ? adxObj.adx : 0;

    const niftyBarIdx = niftyCandles.findIndex(c => c.date >= bar.date);
    const n200 = niftyBarIdx >= offsetNifty200 ? niftySma200[niftyBarIdx - offsetNifty200] : null;
    const niftyClose = niftyBarIdx >= 0 ? niftyCandles[niftyBarIdx]?.close : 0;
    const macroBullish = n200 && niftyClose > n200;

    if (!e20 || !s50 || !s200 || !rsi || !atr) continue;

    // Position management
    if (openPosition) {
      const riskPerShare = openPosition.entryPrice - openPosition.stopLoss;
      const profitPerShare = bar.high - openPosition.entryPrice;

      // Breakeven SL once price moves 1.0R in profit
      if (!openPosition.trailActive && profitPerShare >= riskPerShare * 1.0) {
        openPosition.trailActive = true;
        openPosition.blendedSL = openPosition.entryPrice;
      }

      // Trail 2x ATR below high once price moves 1.5R
      if (openPosition.trailActive && profitPerShare >= riskPerShare * 1.5) {
        const dynamicTrail = bar.high - (atr * 2.0);
        openPosition.blendedSL = Math.max(openPosition.blendedSL, dynamicTrail);
      }

      // 1. Exit at SL / Trailing stop
      if (bar.low <= openPosition.blendedSL) {
        const pnl = openPosition.qty * (openPosition.blendedSL - openPosition.entryPrice);
        capital += pnl + openPosition.qty * openPosition.entryPrice;
        trades.push({ pnl, win: pnl > 0, exitReason: openPosition.trailActive ? 'TRAIL_STOP' : 'SL_HIT' });
        openPosition = null;
      }
      // 2. Target TP (2.5R)
      else if (bar.high >= openPosition.tp) {
        const pnl = openPosition.qty * (openPosition.tp - openPosition.entryPrice);
        capital += pnl + openPosition.qty * openPosition.entryPrice;
        trades.push({ pnl, win: true, exitReason: 'TP_HIT' });
        openPosition = null;
      }
      // 3. Max holding bars (25 bars)
      else if (i - openPosition.entryBar >= 25) {
        const pnl = openPosition.qty * (bar.close - openPosition.entryPrice);
        capital += pnl + openPosition.qty * openPosition.entryPrice;
        trades.push({ pnl, win: pnl > 0, exitReason: 'MAX_HOLD' });
        openPosition = null;
      }
    }

    // Check entry if no open position
    if (!openPosition && macroBullish) {
      // Uptrend: Stock > SMA50 > SMA200 AND ADX > 18
      const uptrend = bar.close > s50 && s50 > s200 && adx > 18;

      // Pullback: Low touched near EMA20 (within 1.5%) in last 3 bars
      const minLow3 = Math.min(lows[i], lows[i - 1], lows[i - 2]);
      const nearEMA20 = minLow3 <= e20 * 1.015 && bar.close >= e20 * 0.985;

      // Reversal: Green candle + RSI > 50 & turning up
      const reversal = bar.close > bar.open && rsi > 50 && rsi > prevRsi;

      if (uptrend && nearEMA20 && reversal) {
        const entryPrice = bar.close;
        const low3 = Math.min(lows[i], lows[i - 1], lows[i - 2]);
        const stopLoss = Math.min(low3 - (atr * 0.5), entryPrice - (atr * 1.2));
        const risk = entryPrice - stopLoss;
        if (risk > 0) {
          const tp = entryPrice + (risk * 2.5);
          const riskAmt = capital * 0.01;
          const qty = Math.floor(riskAmt / risk);
          if (qty > 0 && qty * entryPrice <= capital) {
            capital -= qty * entryPrice;
            openPosition = { entryPrice, stopLoss, blendedSL: stopLoss, tp, qty, entryBar: i, trailActive: false };
          }
        }
      }
    }
  }

  const winTrades = trades.filter(t => t.win);
  const lossTrades = trades.filter(t => !t.win);
  const grossPnl = capital - initialCapital;
  const winRate = trades.length > 0 ? winTrades.length / trades.length : 0;
  const totalWinPnl = winTrades.reduce((s, t) => s + t.pnl, 0);
  const totalLossPnl = Math.abs(lossTrades.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = totalLossPnl > 0 ? totalWinPnl / totalLossPnl : totalWinPnl > 0 ? 99 : 0;

  return { totalTrades: trades.length, winRate, profitFactor, grossPnl, netReturn: (grossPnl / initialCapital) * 100 };
}

async function run() {
  console.log('Testing Pullback-Reversal + ADX Filter + Macro + Trailing Stop...\n');
  const niftyCandles = await fetchCandles('NIFTY50', 500);

  let totalProfitable = 0;
  let totalTrades = 0;
  let avgPF = 0;
  let avgRet = 0;

  for (const sym of TOP_STOCKS) {
    const candles = await fetchCandles(sym, 500);
    const res = runPullbackBacktest(candles, niftyCandles);
    if (res && res.totalTrades > 0) {
      if (res.netReturn > 0) totalProfitable++;
      totalTrades += res.totalTrades;
      avgPF += res.profitFactor;
      avgRet += res.netReturn;
      console.log(`  ${sym.padEnd(15)} Trades: ${String(res.totalTrades).padEnd(4)} | WR: ${(res.winRate * 100).toFixed(0)}% | PF: ${res.profitFactor.toFixed(2)} | Return: ${res.netReturn >= 0 ? '+' : ''}${res.netReturn.toFixed(1)}%`);
    } else {
      console.log(`  ${sym.padEnd(15)} No trades`);
    }
  }

  avgPF /= TOP_STOCKS.length;
  avgRet /= TOP_STOCKS.length;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`PULLBACK REVERSAL + ADX FILTER RESULTS:`);
  console.log(`  Profitable stocks: ${totalProfitable} / ${TOP_STOCKS.length} (${((totalProfitable / TOP_STOCKS.length) * 100).toFixed(0)}%)`);
  console.log(`  Average Profit Factor: ${avgPF.toFixed(2)}`);
  console.log(`  Average Net Return:    ${avgRet >= 0 ? '+' : ''}${avgRet.toFixed(1)}%`);
  console.log(`  Total Trades:          ${totalTrades}`);
  console.log(`${'═'.repeat(60)}`);
}

run();
