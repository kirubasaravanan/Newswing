/**
 * Wallet Service
 * Centralized capital wallet operations — extracted from API routes.
 * All wallet mutations use Prisma transactions.
 */

import { db } from '@/lib/db';

export interface WalletData {
  id: string;
  name: string;
  totalCapital: number;
  initialCapital: number;
  deployed: number;
  available: number;
  realizedPnl: number;
  unrealizedPnl: number;
}

/**
 * Get or create the capital wallet singleton.
 */
export async function getWallet(): Promise<WalletData> {
  let wallet = await db.capitalWallet.findFirst();
  if (!wallet) {
    wallet = await db.capitalWallet.create({
      data: { totalCapital: 200000, initialCapital: 200000, available: 200000 },
    });
  }
  return wallet as WalletData;
}

/**
 * Add realized P&L to wallet (atomic with any calling transaction).
 * MUST be called inside an existing prisma.$transaction callback.
 */
export async function creditRealizedPnl(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  pnl: number
): Promise<void> {
  const wallet = await tx.capitalWallet.findFirst();
  if (!wallet) return;
  const newRealized = Math.round((wallet.realizedPnl + pnl) * 100) / 100;
  const newTotal = Math.round((wallet.initialCapital + newRealized) * 100) / 100;
  await tx.capitalWallet.update({
    where: { id: wallet.id },
    data: {
      realizedPnl: newRealized,
      totalCapital: newTotal,
    },
  });
}

/**
 * Update deployed capital when opening/closing trades.
 */
export async function updateDeployed(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  amountDelta: number // positive = more deployed, negative = less
): Promise<void> {
  const wallet = await tx.capitalWallet.findFirst();
  if (!wallet) return;
  const newDeployed = Math.round((wallet.deployed + amountDelta) * 100) / 100;
  const newAvailable = Math.round((wallet.totalCapital - newDeployed) * 100) / 100;
  await tx.capitalWallet.update({
    where: { id: wallet.id },
    data: {
      deployed: Math.max(0, newDeployed),
      available: Math.max(0, newAvailable),
    },
  });
}

/**
 * Recalculate wallet from all closed trades (audit/reconciliation).
 */
export async function reconcileWallet(): Promise<WalletData> {
  const wallet = await getWallet();
  const closedTrades = await db.paperTrade.findMany({
    where: { status: { in: ['CLOSED', 'AUTO'] } },
    select: { pnl: true },
  });
  const totalRealized = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const corrected = Math.round(totalRealized * 100) / 100;

  if (Math.abs(wallet.realizedPnl - corrected) > 1) {
    await db.capitalWallet.update({
      where: { id: wallet.id },
      data: {
        realizedPnl: corrected,
        totalCapital: Math.round((wallet.initialCapital + corrected) * 100) / 100,
      },
    });
  }

  return getWallet();
}

/**
 * Set initial capital (reset).
 */
export async function setInitialCapital(amount: number): Promise<WalletData> {
  const wallet = await getWallet();
  await db.capitalWallet.update({
    where: { id: wallet.id },
    data: {
      initialCapital: amount,
      totalCapital: amount,
      realizedPnl: 0,
      unrealizedPnl: 0,
      deployed: 0,
      available: amount,
    },
  });
  return getWallet();
}