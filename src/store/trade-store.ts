import { create } from 'zustand';

export type AppTab = 'dashboard' | 'holdings' | 'options' | 'auto-trade' | 'scanner' | 'journal' | 'analytics' | 'backtest' | 'settings';
export type ExecutionMode = 'PAPER' | 'LIVE_DHANHQ';

interface TradeStore {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  executionMode: ExecutionMode;
  setExecutionMode: (mode: ExecutionMode) => void;
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
  executionMode: 'PAPER', // Default to Paper Trading mode to protect real funds!
  setExecutionMode: (mode) => set({ executionMode: mode }),
  screeningResults: [],
  setScreeningResults: (results) => set({ screeningResults: results }),
  isScreening: false,
  setIsScreening: (v) => set({ isScreening: v }),
  lastScanTime: null,
  setLastScanTime: (t) => set({ lastScanTime: t }),
  config: {
    liveCapital: 300000,
    riskPct: 1.0,
    maxSlots: 7,
    maxOpenTrades: 7,
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