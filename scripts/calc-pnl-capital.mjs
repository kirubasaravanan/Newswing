import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  const trades = await db.paperTrade.findMany({ where: { status: 'OPEN' } });
  const wallet = await db.capitalWallet.findFirst();

  let totalUnitCapital = 0;
  let totalPnl = 0;

  console.log('================================================================');
  console.log('         OPEN POSITIONS CAPITAL & REAL-TIME PnL REPORT');
  console.log('================================================================\n');

  trades.forEach((t, i) => {
    const cost = t.entryPrice * t.qty;
    totalUnitCapital += cost;
    const pnl = t.pnl || 0;
    totalPnl += pnl;
    console.log(`[#${i + 1}] ${t.symbol.padEnd(30)} | Entry: ₹${t.entryPrice.toFixed(2)} | Current: ₹${(t.currentPrice || t.entryPrice).toFixed(2)} | Capital: ₹${cost.toFixed(2)} | PnL: ${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(2)}`);
  });

  console.log('\n================================================================');
  console.log('                   EXECUTIVE CAPITAL SUMMARY');
  console.log('================================================================');
  console.log(` • Active Open Positions Count  : ${trades.length}`);
  console.log(` • Total Capital Deployed       : ₹${(wallet?.deployed || totalUnitCapital).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  console.log(` • Total Capital Available      : ₹${(wallet?.available || 200000 - totalUnitCapital).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  console.log(` • Total Initial Portfolio Wallet: ₹${(wallet?.totalCapital || 200000).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  console.log(` • Total Realized PnL           : ₹${(wallet?.realizedPnl || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  console.log(` • Total Unrealized PnL (MTM)   : ₹${(wallet?.unrealizedPnl || totalPnl).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  console.log('================================================================\n');

  await db.$disconnect();
}

main().catch(console.error);
