import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function resetDatabase() {
  console.log('================================================================');
  console.log('   DATABASE CLEAN RESET — PREPARING FRESH TRADING STATE');
  console.log('================================================================\n');

  console.log('1. Deleting all paper trades...');
  const deletedTrades = await db.paperTrade.deleteMany({});
  console.log(`   ✅ Deleted ${deletedTrades.count} old paper trades.`);

  console.log('2. Deleting all auto-trade audit logs...');
  const deletedLogs = await db.autoTradeLog.deleteMany({});
  console.log(`   ✅ Deleted ${deletedLogs.count} audit logs.`);

  console.log('3. Resetting Capital Wallet to initial ₹2,00,000.00...');
  await db.capitalWallet.deleteMany({});
  const wallet = await db.capitalWallet.create({
    data: {
      name: 'Main Wallet',
      totalCapital: 200000,
      initialCapital: 200000,
      deployed: 0,
      available: 200000,
      realizedPnl: 0,
      unrealizedPnl: 0,
      peakCapital: 200000,
      totalCostsPaid: 0,
    }
  });
  console.log('   ✅ Wallet reset successfully:', wallet);

  console.log('\n4. Resetting daily auto-trade counters in appSettings...');
  await db.appSettings.deleteMany({
    where: { key: { in: ['opt_todayEntries', 'opt_todayExits', 'opt_todayPnl', 'opt_lastResetDate'] } }
  });
  console.log('   ✅ App settings reset successfully.');

  console.log('\n================================================================');
  console.log('   DATABASE IS NOW 100% CLEAN AND READY FOR FRESH TRADING!');
  console.log('================================================================\n');

  await db.$disconnect();
}

resetDatabase().catch(console.error);
