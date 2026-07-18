'use client';

import { useState } from 'react';
import { Sidebar } from '@/components/trading/sidebar';
import { DashboardTab } from '@/components/trading/dashboard-tab';
import { HoldingsTab } from '@/components/trading/holdings-tab';
import { ScreenerTab } from '@/components/trading/screener-tab';
import { JournalTab } from '@/components/trading/journal-tab';
import { AnalyticsTab } from '@/components/trading/analytics-tab';
import { BacktestTab } from '@/components/trading/backtest-tab';
import { AutoTradeTab } from '@/components/trading/auto-trade-tab';
import { SettingsTab } from '@/components/trading/settings-tab';
import { useTradeStore } from '@/store/trade-store';
import type { ScreeningResult } from '@/lib/trading/screening-engine';

export default function Home() {
  const { activeTab } = useTradeStore();
  const [prefillTrade, setPrefillTrade] = useState<ScreeningResult | null>(null);

  const handleAddPaperTrade = (result: ScreeningResult) => {
    setPrefillTrade(result);
    useTradeStore.getState().setActiveTab('journal');
  };

  const consumePrefill = () => setPrefillTrade(null);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="pl-16 lg:pl-56">
        <div className="mx-auto max-w-7xl px-4 pt-16 pb-6 lg:px-8 lg:pt-8 lg:pb-8">
          {activeTab === 'dashboard' && <DashboardTab />}
          {activeTab === 'holdings' && <HoldingsTab />}
          {activeTab === 'auto-trade' && <AutoTradeTab />}
          {activeTab === 'scanner' && <ScreenerTab onAddPaperTrade={handleAddPaperTrade} />}
          {activeTab === 'journal' && <JournalTab prefillTrade={prefillTrade} onPrefillConsumed={consumePrefill} />}
          {activeTab === 'analytics' && <AnalyticsTab />}
          {activeTab === 'backtest' && <BacktestTab />}
          {activeTab === 'settings' && <SettingsTab />}
        </div>
      </main>
    </div>
  );
}