import { create } from 'zustand';

export type AppTab = 'screener' | 'journal' | 'backtest' | 'analytics' | 'sizing' | 'universe' | 'autotrade';

interface TradeStore {
  // Navigation
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;

  // Screener
  screeningResults: import('@/lib/trading/screening-engine').ScreeningResult[];
  setScreeningResults: (results: import('@/lib/trading/screening-engine').ScreeningResult[]) => void;
  isScreening: boolean;
  setIsScreening: (v: boolean) => void;
  lastScanTime: string | null;
  setLastScanTime: (t: string | null) => void;

  // Config
  config: import('@/lib/trading/screening-engine').ScreeningConfig;
  setConfig: (c: Partial<import('@/lib/trading/screening-engine').ScreeningConfig>) => void;
}

export const useTradeStore = create<TradeStore>((set) => ({
  activeTab: 'screener',
  setActiveTab: (tab) => set({ activeTab: tab }),

  screeningResults: [],
  setScreeningResults: (results) => set({ screeningResults: results }),
  isScreening: false,
  setIsScreening: (v) => set({ isScreening: v }),
  lastScanTime: null,
  setLastScanTime: (t) => set({ lastScanTime: t }),

  config: {
    liveCapital: 200000,
    riskPct: 1.0,
    maxSlots: 8,
    maxOpenTrades: 3,
    maxHoldBars: 25,
    minScore: 3,
    minRR: 1.5,
    cooldownBars: 1,
    useMacro: true,
    minTurnoverCr: 25.0,
  },
  setConfig: (c) => set((state) => ({ config: { ...state.config, ...c } })),
}));