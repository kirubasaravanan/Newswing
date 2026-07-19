'use client';

import { useState, useEffect } from 'react';
import { Sidebar } from '@/components/trading/sidebar';
import { DashboardTab } from '@/components/trading/dashboard-tab';
import { HoldingsTab } from '@/components/trading/holdings-tab';
import { ScreenerTab } from '@/components/trading/screener-tab';
import { JournalTab } from '@/components/trading/journal-tab';
import { AnalyticsTab } from '@/components/trading/analytics-tab';
import { BacktestTab } from '@/components/trading/backtest-tab';
import { AutoTradeTab } from '@/components/trading/auto-trade-tab';
import { SettingsTab } from '@/components/trading/settings-tab';
import { TabGuard } from '@/components/error-boundary';
import { useTradeStore } from '@/store/trade-store';
import type { ScreeningResult } from '@/lib/trading/screening-engine';
import { AlertTriangle, RefreshCw, Shield } from 'lucide-react';

export default function Home() {
  const { activeTab } = useTradeStore();
  const [prefillTrade, setPrefillTrade] = useState<ScreeningResult | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Catch any unhandled errors
  useEffect(() => {
    const handler = (e: ErrorEvent) => {
      console.error('Uncaught error:', e.error);
      setGlobalError(e.message);
      e.preventDefault();
    };
    const rejHandler = (e: PromiseRejectionEvent) => {
      console.error('Unhandled rejection:', e.reason);
      e.preventDefault();
    };
    window.addEventListener('error', handler);
    window.addEventListener('unhandledrejection', rejHandler);
    return () => {
      window.removeEventListener('error', handler);
      window.removeEventListener('unhandledrejection', rejHandler);
    };
  }, []);

  const handleAddPaperTrade = (result: ScreeningResult) => {
    setPrefillTrade(result);
    useTradeStore.getState().setActiveTab('journal');
  };

  const consumePrefill = () => setPrefillTrade(null);

  if (globalError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/10 mx-auto">
            <Shield className="h-8 w-8 text-indigo-400" />
          </div>
          <h1 className="text-xl font-bold text-foreground">PMS Manager</h1>
          <p className="text-sm text-muted-foreground">An error occurred while loading.</p>
          <p className="text-xs text-muted-foreground/60 font-mono break-all bg-secondary/50 rounded-lg p-3">{globalError}</p>
          <button onClick={() => { setGlobalError(null); window.location.reload(); }} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 transition-colors mx-auto">
            <RefreshCw className="h-4 w-4" /> Reload
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="pl-16 lg:pl-56">
        <div className="mx-auto max-w-7xl px-4 pt-16 pb-6 lg:px-8 lg:pt-8 lg:pb-8">
          {activeTab === 'dashboard' && <TabGuard><DashboardTab /></TabGuard>}
          {activeTab === 'holdings' && <TabGuard><HoldingsTab /></TabGuard>}
          {activeTab === 'auto-trade' && <TabGuard><AutoTradeTab /></TabGuard>}
          {activeTab === 'scanner' && <TabGuard><ScreenerTab onAddPaperTrade={handleAddPaperTrade} /></TabGuard>}
          {activeTab === 'journal' && <TabGuard><JournalTab prefillTrade={prefillTrade} onPrefillConsumed={consumePrefill} /></TabGuard>}
          {activeTab === 'analytics' && <TabGuard><AnalyticsTab /></TabGuard>}
          {activeTab === 'backtest' && <TabGuard><BacktestTab /></TabGuard>}
          {activeTab === 'settings' && <TabGuard><SettingsTab /></TabGuard>}
        </div>
      </main>
    </div>
  );
}