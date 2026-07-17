'use client';

import { useState, useRef } from 'react';
import { Sidebar } from '@/components/trading/sidebar';
import { ScreenerTab } from '@/components/trading/screener-tab';
import { JournalTab } from '@/components/trading/journal-tab';
import { BacktestTab } from '@/components/trading/backtest-tab';
import { AnalyticsTab } from '@/components/trading/analytics-tab';
import { SizingTab } from '@/components/trading/sizing-tab';
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
      
      {/* Main Content */}
      <main className="lg:pl-56">
        <div className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
          {/* Top Bar */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold tracking-tight">V-Swing Trading Desk</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                v65.5 — NSE Swing Scanner, Paper Trading Journal & Backtester
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="hidden sm:flex items-center gap-1.5 rounded-lg bg-secondary/50 px-3 py-1.5">
                <div className="h-2 w-2 rounded-full bg-emerald-400" />
                <span>Market: NSE</span>
              </div>
            </div>
          </div>

          {/* Tab Content */}
          {activeTab === 'screener' && <ScreenerTab onAddPaperTrade={handleAddPaperTrade} />}
          {activeTab === 'journal' && <JournalTab prefillTrade={prefillTrade} onPrefillConsumed={consumePrefill} />}
          {activeTab === 'backtest' && <BacktestTab />}
          {activeTab === 'analytics' && <AnalyticsTab />}
          {activeTab === 'sizing' && <SizingTab />}
        </div>
      </main>
    </div>
  );
}