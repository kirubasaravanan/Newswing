import { create } from 'zustand';

export type AppTab = 'dashboard' | 'holdings' | 'options' | 'auto-trade' | 'scanner' | 'journal' | 'analytics' | 'backtest' | 'settings';

interface TradeStore {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  screeningResults: any[];
  setScreeningResults: (results: any[]) => void;
  isScreening: boolean;
  setIsScreening: (v: boolean) => void;
  lastScanTime: string | null;
  setLastScanTime: (t: string | null) => void;
  config: any;
  setConfig: (c: any) => void;
  // Options state
  optionTrades: any[];
  setOptionTrades: (trades: any[]) => void;
  optionStrategies: any[];
  setOptionStrategies: (strategies: any[]) => void;
}

export const useTradeStore = create<TradeStore>((set) => ({
  activeTab: 'dashboard',
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
  // Options state
  optionTrades: [] as any[],
  optionStrategies: [] as any[],
  setOptionTrades: (trades: any[]) => set({ optionTrades: trades }),
  setOptionStrategies: (strategies: any[]) => set({ optionStrategies: strategies }),
}));