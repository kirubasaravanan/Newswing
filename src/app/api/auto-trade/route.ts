/**
 * Auto-Trade Engine API
 * Handles: scan & auto-enter, check exits, wallet management, position rules
 */
import { NextRequest, NextResponse } from 'next/server';
import { runScreening, DEFAULT_CONFIG, type ScreeningConfig } from '@/lib/trading/screening-engine';
import { getHistoricalData, getCurrentPrice } from '@/lib/trading/data-provider';
import { getFullUniverse, runL1Filter, type NSEStock } from '@/lib/trading/universe-scanner';
import { db } from '@/lib/db';

interface PositionRules {
  maxPerStock: number;
  maxBuysPerMonth: number;
  maxHoldingDays: number;
  maxTotalPositions: number;
  riskPerTradePct: number;
}
const DEFAULT_RULES: PositionRules = {
  maxPerStock: 50000, maxBuysPerMonth: 3, maxHoldingDays: 25,
  maxTotalPositions: 8, riskPerTradePct: 1.0,
};

async function getRules(): Promise<PositionRules> {
  try {
    const s = await db.appSettings.findMany();
    const m: Record<string, string> = {};
    for (const x of s) m[x.key] = x.value;
    return {
      maxPerStock: parseFloat(m['rules_maxPerStock'] || '') || DEFAULT_RULES.maxPerStock,
      maxBuysPerMonth: parseInt(m['rules_maxBuysPerMonth'] || '') || DEFAULT_RULES.maxBuysPerMonth,
      maxHoldingDays: parseInt(m['rules_maxHoldingDays'] || '') || DEFAULT_RULES.maxHoldingDays,
      maxTotalPositions: parseInt(m['rules_maxTotalPositions'] || '') || DEFAULT_RULES.maxTotalPositions,
      riskPerTradePct: parseFloat(m['rules_riskPerTradePct'] || '') || DEFAULT_RULES.riskPerTradePct,
    };
  } catch { return DEFAULT_RULES; }
}

async function getWallet() {
  let w = await db.capitalWallet.findFirst();
  if (!w) w = await db.capitalWallet.create({ data: { totalCapital: 200000, available: 200000 } });
  return w;
}

async function recalcWallet() {
  const w = await getWallet();
  const open = await db.paperTrade.findMany({ where: { status: 'OPEN' } });
  const deployed = open.reduce((s, t) => s + t.entryPrice * t.qty, 0);
  const total = w.totalCapital + w.realizedPnl;
  let unrealizedPnl = 0;
  const syms = [...new Set(open.map(t => t.symbol))];
  for (const sym of syms) {
    try {
      const { price } = await getCurrentPrice(sym);
      for (const t of open.filter(t => t.symbol === sym)) {
        unrealizedPnl += (price - t.entryPrice) * t.qty;
      }
    } catch { /* skip */ }
  }
  await db.capitalWallet.update({ where: { id: w.id }, data: { deployed, available: total - deployed, unrealizedPnl, totalCapital: total } });
  return { ...w, deployed, available: total - deployed, unrealizedPnl, totalCapital: total };
}

async function canOpen(symbol: string, entryPrice: number, qty: number, rules: PositionRules) {
  const w = await getWallet();
  const open = await db.paperTrade.findMany({ where: { status: 'OPEN' } });
  const now = new Date();
  if (open.length >= rules.maxTotalPositions) return { ok: false, reason: `Max ${rules.maxTotalPositions} positions` };
  const stockOpen = open.filter(t => t.symbol === symbol);
  const stockDep = stockOpen.reduce((s, t) => s + t.entryPrice * t.qty, 0);
  if (stockDep + entryPrice * qty > rules.maxPerStock) return { ok: false, reason: `Max ₹${rules.maxPerStock}/stock` };
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthTrades = await db.paperTrade.count({ where: { symbol, entryDate: { gte: monthStart } } });
  if (monthTrades >= rules.maxBuysPerMonth) return { ok: false, reason: `Max ${rules.maxBuysPerMonth} buys/month` };
  if (entryPrice * qty > w.available) return { ok: false, reason: 'Insufficient capital' };
  return { ok: true };
}

async function autoScanAndTrade(config: ScreeningConfig) {
  const rules = await getRules();
  const stocks = getFullUniverse();
  const entries: any[] = [];
  const skipped: any[] = [];
  const { data: niftyData } = await getHistoricalData('NIFTY50', 350);

  // L1 filter
  const BATCH = 15;
  const l1Pass: { stock: NSEStock; data: any[] }[] = [];
  for (let i = 0; i < stocks.length; i += BATCH) {
    const batch = stocks.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(async (stock) => {
      const { data } = await getHistoricalData(stock.symbol, 300);
      return { stock, data };
    }));
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const l1 = runL1Filter(r.value.stock.symbol, r.value.stock.name, r.value.stock.sector, r.value.stock.category, r.value.data);
      if (l1 && l1.passed) l1Pass.push(r.value);
    }
  }

  // L2 V-Swing + auto-enter
  for (const { stock, data } of l1Pass) {
    try {
      const signal = runScreening(stock.symbol, data, niftyData, config);
      if (!signal) continue;
      const qty = signal.setupType === 'A+' ? signal.sizing.qtyA : signal.sizing.qtyB;
      if (qty <= 0) { skipped.push({ symbol: stock.symbol, reason: 'Qty=0' }); continue; }
      const check = await canOpen(stock.symbol, signal.entryPrice, qty, rules);
      if (!check.ok) { skipped.push({ symbol: stock.symbol, reason: check.reason }); continue; }
      const existing = await db.paperTrade.count({ where: { symbol: stock.symbol, status: 'OPEN' } });
      if (existing > 0) { skipped.push({ symbol: stock.symbol, reason: 'Open position exists' }); continue; }

      const trade = await db.paperTrade.create({
        data: {
          symbol: stock.symbol, stockName: stock.name, direction: 'LONG',
          entryDate: new Date(), entryPrice: signal.entryPrice, qty,
          stopLoss: signal.stopLoss, targetPrice: signal.targetPrice,
          autoTraded: true,
          notes: `AUTO | ${signal.setupType} | Score:${signal.score}/6 | R:R:${signal.riskReward}x`,
          tags: `auto,${signal.setupType === 'A+' ? 'aplus' : 'b'},score-${signal.score}`,
        },
      });
      await db.autoTradeLog.create({
        data: {
          action: 'AUTO_ENTRY', symbol: stock.symbol, tradeId: trade.id,
          signal: JSON.stringify(signal), executed: true,
          reason: `${signal.setupType} | Score ${signal.score}/6 | Qty ${qty}`,
        },
      });
      entries.push({ symbol: stock.symbol, setupType: signal.setupType, score: signal.score, entryPrice: signal.entryPrice, qty, tradeId: trade.id });
    } catch (err) { skipped.push({ symbol: stock.symbol, reason: String(err) }); }
  }
  await recalcWallet();
  return { entries, skipped };
}

async function autoCheckExits() {
  const rules = await getRules();
  const openTrades = await db.paperTrade.findMany({ where: { status: 'OPEN' }, orderBy: { entryDate: 'asc' } });
  const exits: any[] = [];
  const holding: any[] = [];

  for (const trade of openTrades) {
    try {
      const { price: cp } = await getCurrentPrice(trade.symbol);
      const days = Math.floor((Date.now() - new Date(trade.entryDate).getTime()) / 86400000);
      let shouldExit = false;
      let reason = '';
      let exitPrice = cp;

      if (cp <= trade.stopLoss) { shouldExit = true; reason = 'SL_HIT'; exitPrice = trade.stopLoss; }
      else if (cp >= trade.targetPrice) { shouldExit = true; reason = 'TP_HIT'; exitPrice = trade.targetPrice; }
      else if (days >= rules.maxHoldingDays) { shouldExit = true; reason = 'MAX_HOLDING'; }
      else {
        const risk = trade.entryPrice - trade.stopLoss;
        if (risk > 0 && (cp - trade.entryPrice) / risk >= 1.5 && cp <= trade.entryPrice) {
          shouldExit = true; reason = 'TRAIL_STOP'; exitPrice = trade.entryPrice;
        }
      }

      if (shouldExit) {
        const pnl = (exitPrice - trade.entryPrice) * trade.qty;
        const pnlPct = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
        await db.paperTrade.update({
          where: { id: trade.id },
          data: { status: 'CLOSED', exitDate: new Date(), exitPrice, pnl, pnlPercent: pnlPct, exitReason: reason },
        });
        const w = await getWallet();
        await db.capitalWallet.update({ where: { id: w.id }, data: { realizedPnl: w.realizedPnl + pnl } });
        await db.autoTradeLog.create({
          action: `AUTO_EXIT_${reason}`, symbol: trade.symbol, tradeId: trade.id,
          executed: true, reason: `${reason} | ₹${trade.entryPrice}→₹${exitPrice} | P&L: ₹${pnl.toLocaleString()}`,
        });
        exits.push({ symbol: trade.symbol, exitReason: reason, entryPrice: trade.entryPrice, exitPrice, pnl, pnlPercent: pnlPct, holdingDays: days });
      } else {
        holding.push({
          symbol: trade.symbol, entryPrice: trade.entryPrice, currentPrice: cp,
          pnl: (cp - trade.entryPrice) * trade.qty,
          pnlPercent: ((cp - trade.entryPrice) / trade.entryPrice) * 100,
          holdingDays: days, maxHoldingDays: rules.maxHoldingDays,
          sl: trade.stopLoss, tp: trade.targetPrice,
        });
      }
    } catch { holding.push({ symbol: trade.symbol, error: 'Price fetch failed' }); }
  }
  if (exits.length > 0) await recalcWallet();
  return { exits, holding };
}

export async function GET() {
  try {
    const wallet = await recalcWallet();
    const openTrades = await db.paperTrade.findMany({ where: { status: 'OPEN', autoTraded: true }, orderBy: { entryDate: 'desc' } });
    const recentLogs = await db.autoTradeLog.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    const rules = await getRules();
    return NextResponse.json({ success: true, wallet, rules, openTrades, recentLogs });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action: string = body.action || 'get_status';
    const config: ScreeningConfig = { ...DEFAULT_CONFIG, ...body.config };

    if (action === 'scan_and_trade') {
      const result = await autoScanAndTrade(config);
      return NextResponse.json({ success: true, action, ...result });
    }
    if (action === 'check_exits') {
      const result = await autoCheckExits();
      return NextResponse.json({ success: true, action, ...result });
    }
    if (action === 'update_wallet') {
      const { totalCapital } = body;
      if (totalCapital) {
        const w = await getWallet();
        const open = await db.paperTrade.findMany({ where: { status: 'OPEN' } });
        const deployed = open.reduce((s, t) => s + t.entryPrice * t.qty, 0);
        await db.capitalWallet.update({ where: { id: w.id }, data: { totalCapital, available: totalCapital - deployed } });
        const updated = await recalcWallet();
        return NextResponse.json({ success: true, wallet: updated });
      }
    }
    if (action === 'update_rules') {
      const rules = body.rules;
      if (rules) {
        for (const [key, value] of Object.entries(rules)) {
          await db.appSettings.upsert({
            where: { key: `rules_${key}` },
            create: { key: `rules_${key}`, value: String(value) },
            update: { value: String(value) },
          });
        }
        return NextResponse.json({ success: true, rules: await getRules() });
      }
    }
    const wallet = await recalcWallet();
    return NextResponse.json({ success: true, wallet });
  } catch (error) {
    console.error('Auto-trade error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}