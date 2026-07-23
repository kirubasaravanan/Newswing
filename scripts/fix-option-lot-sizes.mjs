import { PrismaClient } from '@prisma/client';
import { getOptionLotSize } from '../src/app/api/auto-trade/route.ts';

const db = new PrismaClient();

async function main() {
  console.log('Updating database paper trades to use official exchange contract lot sizes...\n');

  const trades = await db.paperTrade.findMany({ where: { status: 'OPEN' } });

  let updatedCount = 0;
  let totalDeployed = 0;

  for (const t of trades) {
    const symbolParts = t.symbol.split('_');
    const underlying = symbolParts[0];
    const lotSize = getOptionLotSize(underlying);

    if (t.qty !== lotSize) {
      await db.paperTrade.update({
        where: { id: t.id },
        data: { qty: lotSize }
      });
      updatedCount++;
    }

    const tradeCost = t.entryPrice * lotSize;
    totalDeployed += tradeCost;
    console.log(`• Updated ${t.symbol.padEnd(30)} : Qty = ${lotSize.toString().padStart(4)} | Premium = ₹${t.entryPrice.toFixed(2).padStart(6)} | Total Contract Value = ₹${tradeCost.toFixed(2)}`);
  }

  // Recalculate Capital Wallet
  const initialCap = 200000;
  const availableCap = Math.max(0, initialCap - totalDeployed);

  await db.capitalWallet.updateMany({
    data: {
      deployed: totalDeployed,
      available: availableCap,
      totalCapital: initialCap,
      peakCapital: Math.max(initialCap, totalDeployed),
    }
  });

  console.log('\n================================================================');
  console.log('               UPDATED CAPITAL WALLET SUMMARY');
  console.log('================================================================');
  console.log(` • Updated Open Positions       : ${updatedCount} / ${trades.length}`);
  console.log(` • Real Full Exchange Deployed  : ₹${totalDeployed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  console.log(` • Available Remaining Capital  : ₹${availableCap.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  console.log(` • Total Initial Wallet Capital : ₹${initialCap.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  console.log('================================================================\n');

  await db.$disconnect();
}

main().catch(console.error);
