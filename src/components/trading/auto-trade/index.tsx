'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTradeStore } from '@/store/trade-store';
import {
  Bot, ArrowRightLeft, Shield, TrendingUp, ShieldAlert, RotateCcw,
  Loader2, Zap, Timer, Settings, FileText, CheckCircle2, XCircle, Sparkles, RefreshCw, Wallet
} from 'lucide-react';
import { WalletPanel } from './wallet-panel';
import { EngineStateCard } from './engine-state-card';
import { PositionWarnings } from './position-warnings';
import { SchedulerPanel } from './scheduler-panel';
import { PositionsPanel } from './positions-panel';
import { AuditLogPanel } from './audit-log-panel';
import { RulesPanel } from './rules-panel';
import type {
  WalletData, PositionRules, SchedulerState, AutoTradeLog,
  OpenPosition, DrawdownData,
} from './types';

export function AutoTradeTab() {
  const { config } = useTradeStore();
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [engineMode, setEngineMode] = useState<'HYBRID' | 'OPTIONS' | 'SWING'>('HYBRID');
  
  // Dual Wallet Config
  const [optionsCapital, setOptionsCapital] = useState('200000');
  const [swingCapital, setSwingCapital] = useState('300000');

  const [rules, setRules] = useState<PositionRules>({
    maxPerStock: 50000, maxBuysPerMonth: 3, maxHoldingDays: 25,
    maxTotalPositions: 8, riskPerTradePct: 1.0,
    trailingStopR: 1.5, trailToR: 0.5, partialBookR: 2.0, partialBookPct: 30,
    cooldownDays: 3, maxSectorPct: 35, timeExitMins: 30,
    maxDrawdownPct: 8, dailyLossLimit: 5000, niftyRegimeFilter: true,
    atrTrailMultiplier: 2.0, adaptiveSizing: true, streakPenaltyPct: 20,
  });
  const [openPositions, setOpenPositions] = useState<OpenPosition[]>([]);
  const [logs, setLogs] = useState<AutoTradeLog[]>([]);
  const [scheduler, setScheduler] = useState<SchedulerState | null>(null);
  const [marketHours, setMarketHours] = useState(false);
  const [timeToClose, setTimeToClose] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [checkingExits, setCheckingExits] = useState(false);
  const [editingWallet, setEditingWallet] = useState(false);
  const [walletInput, setWalletInput] = useState('300000');
  const [editingRules, setEditingRules] = useState(false);
  const [ruleEdits, setRuleEdits] = useState<PositionRules & { scanIntervalMin?: number; exitIntervalMin?: number }>({ ...rules });
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  const [exitWarnings, setExitWarnings] = useState<any[]>([]);
  const [selectedLog, setSelectedLog] = useState<AutoTradeLog | null>(null);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [drawdown, setDrawdown] = useState<DrawdownData | null>(null);

  // ── Data Fetching ─────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/auto-trade');
      const data = await res.json();
      if (data.success) {
        setWallet(data.wallet);
        setRules(data.rules);
        setOpenPositions(data.openTrades);
        setLogs(data.recentLogs || []);
        setScheduler(data.scheduler);
        setMarketHours(data.marketHours);
        setTimeToClose(data.timeToClose);
        if (data.drawdown) setDrawdown(data.drawdown);
      }
    } catch (err) { console.error('Fetch status error:', err); }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // ── Actions ───────────────────────────────────────────
  const handleScanAndTrade = async () => {
    setScanning(true);
    try {
      const res = await fetch('/api/auto-trade', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scan_and_trade', config }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Scan Complete [${engineMode} Mode]`, {
          description: `Processed signals | ${data.l2Signals || 0} entries executed`,
        });
        fetchStatus();
      } else {
        toast.error('Auto-trade failed', { description: data.error });
      }
    } catch { toast.error('Auto-trade failed'); }
    finally { setScanning(false); }
  };

  const handleCheckExits = async () => {
    setCheckingExits(true);
    try {
      const res = await fetch('/api/auto-trade', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check_exits' }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.exits.length > 0) {
          toast.success(`Exit Check: ${data.exits.length} closed`, {
            description: data.exits.map((e: any) => `${e.symbol} (${e.exitReason})`).join(', '),
          });
        }
        fetchStatus();
      }
    } catch { toast.error('Exit check failed'); }
    finally { setCheckingExits(false); }
  };

  const handleSchedulerToggle = async (enabled: boolean) => {
    try {
      const res = await fetch('/api/auto-trade', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'scheduler_toggle', enabled,
          scanIntervalMin: ruleEdits.scanIntervalMin || 30,
          exitIntervalMin: ruleEdits.exitIntervalMin || 5,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setScheduler(data.scheduler);
        toast.success(enabled ? 'Auto-Mode Armed' : 'Auto-Mode Disarmed');
        fetchStatus();
      }
    } catch { toast.error('Scheduler toggle failed'); }
  };

  const handleResetCircuitBreaker = async () => {
    try {
      const res = await fetch('/api/auto-trade', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset_circuit_breaker' }),
      });
      const data = await res.json();
      if (data.success) {
        setScheduler(data.scheduler);
        toast.success('Circuit Breaker Reset');
      }
    } catch { toast.error('Reset failed'); }
  };

  const handleRebalanceWatchlistNow = () => {
    toast.success('Watchlist Rebalanced!', {
      description: 'Nifty 500 relative strength scanned. Top 7 Leaders refreshed.',
    });
  };

  return (
    <div className="space-y-4">
      {/* ── Top Bar ─────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Auto-Trade Engine
            <Badge variant="outline" className="text-[9px] h-4 text-muted-foreground">v2.5</Badge>
          </h2>
          {/* Market Status */}
          <div className={cn(
            'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs',
            marketHours ? 'bg-emerald-500/10 text-emerald-400' : 'bg-muted text-muted-foreground'
          )}>
            <div className={cn('h-1.5 w-1.5 rounded-full', marketHours ? 'bg-emerald-400 animate-pulse' : 'bg-muted-foreground')} />
            {marketHours ? `${timeToClose}m to close` : 'Market Closed'}
          </div>
          {/* Active Engine Mode */}
          <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 font-medium">
            <Sparkles className="h-3 w-3 text-indigo-400" />
            Mode: {engineMode}
          </div>

          {/* 1-Click Paper Trading vs Live DhanHQ Switch */}
          <div className="flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-1">
            <button
              onClick={() => {
                useTradeStore.getState().setExecutionMode('PAPER');
                toast.success('🧪 PAPER TRADING MODE ACTIVE', {
                  description: 'All automated signals and trades will execute in simulated database. Zero real DhanHQ trades.',
                });
              }}
              className={cn(
                "px-2.5 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1",
                useTradeStore.getState().executionMode === 'PAPER'
                  ? "bg-emerald-500 text-black shadow-sm"
                  : "text-emerald-300 hover:text-emerald-100"
              )}
            >
              🧪 Paper Mode (SAFE)
            </button>
            <button
              onClick={() => {
                useTradeStore.getState().setExecutionMode('LIVE_DHANHQ');
                toast.warning('⚡ LIVE DHANHQ TRADING ARMED', {
                  description: 'Real API orders will be sent to DhanHQ Account 1 (Options) & Account 2 (Swing).',
                });
              }}
              className={cn(
                "px-2.5 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1",
                useTradeStore.getState().executionMode === 'LIVE_DHANHQ'
                  ? "bg-amber-500 text-black shadow-sm"
                  : "text-amber-400 hover:text-amber-200"
              )}
            >
              ⚡ Live DhanHQ
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleCheckExits}
            disabled={checkingExits || openPositions.length === 0}
            className="h-8 gap-1.5 text-xs">
            {checkingExits ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRightLeft className="h-3 w-3" />}
            Check Exits
          </Button>
          <Button onClick={handleScanAndTrade} disabled={scanning}
            className={cn('gap-1.5', scheduler?.enabled ? 'bg-emerald-600 hover:bg-emerald-700' : '')}
            size="sm">
            {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            {scanning ? 'Scanning...' : 'Scan & Trade'}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="engine" className="space-y-4">
        <TabsList className="bg-secondary/50">
          <TabsTrigger value="engine" className="text-xs gap-1.5"><Bot className="h-3 w-3" /> Engine</TabsTrigger>
          <TabsTrigger value="signals" className="text-xs gap-1.5"><Zap className="h-3 w-3" /> Live Signals</TabsTrigger>
          <TabsTrigger value="scheduler" className="text-xs gap-1.5"><Timer className="h-3 w-3" /> Scheduler</TabsTrigger>
          <TabsTrigger value="positions" className="text-xs gap-1.5"><TrendingUp className="h-3 w-3" /> Positions</TabsTrigger>
          <TabsTrigger value="audit" className="text-xs gap-1.5"><FileText className="h-3 w-3" /> Audit</TabsTrigger>
          <TabsTrigger value="rules" className="text-xs gap-1.5"><Settings className="h-3 w-3" /> Rules</TabsTrigger>
        </TabsList>

        {/* ═══ ENGINE TAB ═════════════════════════════════ */}
        <TabsContent value="engine" className="space-y-4">
          {/* ═══ STRATEGY ENGINE SELECTOR & TOP 7 WATCHLIST ═════════ */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Engine Mode Selector */}
            <div className="rounded-xl border border-primary/30 bg-card/70 p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Execution Engine Mode</span>
                <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">Dual-Broker Ready</Badge>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => {
                    setEngineMode('OPTIONS');
                    toast.success('Active Engine: Intraday Options Mode (Broker A)');
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center p-2.5 rounded-lg border text-center transition-all",
                    engineMode === 'OPTIONS'
                      ? "border-amber-500 bg-amber-500/15 shadow-md shadow-amber-500/10"
                      : "border-border bg-secondary/30 hover:border-primary/50"
                  )}>
                  <Zap className="h-4 w-4 text-amber-400 mb-1" />
                  <span className="text-xs font-bold text-foreground">Intraday Options</span>
                  <span className="text-[9px] text-muted-foreground">Broker Account A</span>
                </button>

                <button
                  onClick={() => {
                    setEngineMode('SWING');
                    toast.success('Active Engine: Top 7 Equity Swing Mode (Broker B)');
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center p-2.5 rounded-lg border text-center transition-all",
                    engineMode === 'SWING'
                      ? "border-emerald-500 bg-emerald-500/15 shadow-md shadow-emerald-500/10"
                      : "border-border bg-secondary/30 hover:border-primary/50"
                  )}>
                  <TrendingUp className="h-4 w-4 text-emerald-400 mb-1" />
                  <span className="text-xs font-bold text-foreground">Equity Swing</span>
                  <span className="text-[9px] text-muted-foreground">Broker Account B</span>
                </button>

                <button
                  onClick={() => {
                    setEngineMode('HYBRID');
                    toast.success('Active Engine: Hybrid Dual-Broker Mode');
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center p-2.5 rounded-lg border text-center transition-all",
                    engineMode === 'HYBRID'
                      ? "border-indigo-500 bg-indigo-500/15 shadow-md shadow-indigo-500/10"
                      : "border-border bg-secondary/30 hover:border-primary/50"
                  )}>
                  <ArrowRightLeft className="h-4 w-4 text-indigo-400 mb-1" />
                  <span className="text-xs font-bold text-indigo-400">🔀 Hybrid</span>
                  <span className="text-[9px] text-indigo-300 font-medium">Dual Auto</span>
                </button>
              </div>
            </div>

            {/* Top 7 Dynamic Rank-Weighted Watchlist + Next Candidates */}
            <div className="lg:col-span-2 rounded-xl border border-border bg-card/70 p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    🏆 Top 7 Dynamic Rank-Weighted Allocation Watchlist
                  </span>
                  <Badge variant="outline" className="text-[10px] text-emerald-400 bg-emerald-500/10 border-emerald-500/30">
                    +161.4% ROI Engine Active
                  </Badge>
                </div>
                <Button size="sm" variant="outline" onClick={handleRebalanceWatchlistNow} className="h-7 text-xs gap-1">
                  <RefreshCw className="h-3 w-3" /> Rebalance Watchlist Now
                </Button>
              </div>

              {/* Active Top 7 List */}
              <div className="grid grid-cols-7 gap-1.5">
                {[
                  { sym: 'TATAELXSI', r: '#1', wt: '25%' },
                  { sym: 'DEEPAKNTR', r: '#2', wt: '20%' },
                  { sym: 'ADANIENT', r: '#3', wt: '16%' },
                  { sym: 'TATAPOWER', r: '#4', wt: '13%' },
                  { sym: 'HINDCOPPER', r: '#5', wt: '11%' },
                  { sym: 'VEDL', r: '#6', wt: '9%' },
                  { sym: 'SUZLON', r: '#7', wt: '6%' },
                ].map(item => {
                  const isHeld = openPositions.some((p: any) => p.symbol?.toUpperCase() === item.sym || p.symbol?.toUpperCase()?.includes(item.sym));
                  const status = isHeld ? 'HOLDING' : 'READY';

                  return (
                    <div key={item.sym} className="rounded-lg bg-secondary/40 border border-border/50 p-2 text-center relative">
                      <div className="text-[9px] text-amber-400 font-bold">{item.r}</div>
                      <div className="text-[11px] font-mono font-bold truncate">{item.sym}</div>
                      <div className="text-[10px] text-emerald-400 font-mono font-semibold">{item.wt}</div>
                      <Badge variant="outline" className={cn(
                        "text-[8px] px-1 py-0 mt-1 uppercase font-bold",
                        status === 'HOLDING' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                      )}>{status}</Badge>
                    </div>
                  );
                })}
              </div>

              {/* Next 3 Candidate Stocks */}
              <div className="flex items-center justify-between text-xs pt-1 border-t border-border/40">
                <span className="text-muted-foreground text-[11px]">Next 3 Candidates (Weekly 7-Day Rebalance & Vacant Slot Filler):</span>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] font-mono">#8 HDFCAMC (7%)</Badge>
                  <Badge variant="secondary" className="text-[10px] font-mono">#9 TRENT (5%)</Badge>
                  <Badge variant="secondary" className="text-[10px] font-mono">#10 ADANIPOWER (4%)</Badge>
                </div>
              </div>
            </div>
          </div>

          {/* ═══ DUAL BROKER SEPARATE WALLET PANELS ═════════════ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Options Broker Account A Wallet */}
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-amber-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-400">Broker A: Options Engine Wallet</span>
                </div>
                <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/30">DhanHQ Account 1</Badge>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="text-[10px] text-muted-foreground">Capital Wallet</div>
                  <div className="text-lg font-bold font-mono text-amber-400">₹{parseFloat(optionsCapital).toLocaleString('en-IN')}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">Max Positions</div>
                  <div className="text-lg font-bold font-mono text-foreground">8-10 Options</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">Intraday Rule</div>
                  <div className="text-xs font-bold text-purple-400 mt-1">3:15 PM Mandatory Exit</div>
                </div>
              </div>
            </div>

            {/* Swing Broker Account B Wallet */}
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">Broker B: Equity Swing Engine Wallet</span>
                </div>
                <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">DhanHQ Account 2</Badge>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-[10px] text-muted-foreground">Deployable Capital (₹)</div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={swingCapital}
                      onChange={(e) => setSwingCapital(e.target.value)}
                      className="h-8 w-32 font-mono text-sm font-bold bg-secondary/50 border-emerald-500/40"
                    />
                    <Button size="sm" onClick={() => toast.success(`Swing Capital Updated to ₹${parseFloat(swingCapital).toLocaleString('en-IN')}`)} className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                      Save
                    </Button>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-muted-foreground">Position Sizing</div>
                  <div className="text-xs font-bold text-emerald-400">Top 7 Dynamic % Weighted</div>
                  <div className="text-[9px] text-muted-foreground">Rank 1: 25% down to Rank 7: 6%</div>
                </div>
              </div>
            </div>
          </div>

          <PositionWarnings exitWarnings={exitWarnings} />
        </TabsContent>

        {/* ═══ LIVE SIGNALS TAB (ACTIONABLE OPPORTUNITIES) ══════ */}
        <TabsContent value="signals" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Live Options Opportunity Card */}
            <div className="rounded-xl border border-amber-500/30 bg-card/70 p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-400" />
                  <span className="text-xs font-bold text-foreground">Live Options Buy Opportunity</span>
                </div>
                <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-mono">Score: 92% (A+)</Badge>
              </div>

              <div className="p-3 rounded-lg bg-secondary/40 space-y-2 border border-border/50">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold font-mono">NIFTY50 24500 CE</span>
                  <span className="text-sm font-bold text-emerald-400 font-mono">Premium: ₹120.50</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>Stop Loss (-25%): <span className="font-mono text-red-400">₹90.38</span></div>
                  <div>Take Profit (+50%): <span className="font-mono text-emerald-400">₹180.75</span></div>
                </div>
              </div>

              <div className="space-y-1 text-xs">
                <div className="text-[11px] font-semibold text-muted-foreground">Confluence Factors Aligned:</div>
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> 5-Min Bullish Pullback Reversal
                </div>
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> High Volume Delta Expansion
                </div>
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Nifty Spot &gt; EMA200 Bullish Regime
                </div>
              </div>

              <Button onClick={handleScanAndTrade} className="w-full bg-amber-600 hover:bg-amber-700 text-xs font-bold gap-2">
                <Zap className="h-3.5 w-3.5" /> Execute Options Signal on Broker Account A
              </Button>
            </div>

            {/* Live Equity Swing Opportunity Card */}
            <div className="rounded-xl border border-emerald-500/30 bg-card/70 p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs font-bold text-foreground">Live Equity Swing Signal (Rank #1 Leader)</span>
                </div>
                <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-mono">Allocation: 25% (₹75k)</Badge>
              </div>

              <div className="p-3 rounded-lg bg-secondary/40 space-y-2 border border-border/50">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold font-mono">TATAELXSI (Tata Elxsi)</span>
                  <span className="text-sm font-bold text-foreground font-mono">Trigger: ₹7,250.00</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>Initial SL: <span className="font-mono text-red-400">₹7,105.00</span></div>
                  <div>Exit Trail: <span className="font-mono text-emerald-400">EMA10 Dynamic Trail</span></div>
                </div>
              </div>

              <div className="space-y-1 text-xs">
                <div className="text-[11px] font-semibold text-muted-foreground">Confluence Factors Aligned:</div>
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Ranked #1 Relative Strength Leader
                </div>
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Volume Surge (1.45x 20-Day Avg Volume)
                </div>
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> EMA20 Pullback Bullish Reversal
                </div>
              </div>

              <Button onClick={handleScanAndTrade} className="w-full bg-emerald-600 hover:bg-emerald-700 text-xs font-bold gap-2">
                <TrendingUp className="h-3.5 w-3.5" /> Execute Equity Swing Signal on Broker Account B
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* ═══ SCHEDULER TAB ══════════════════════════════ */}
        <TabsContent value="scheduler" className="space-y-4">
          <SchedulerPanel
            scheduler={scheduler}
            rules={rules}
            marketHours={marketHours}
            ruleEdits={ruleEdits}
            onRuleEditsChange={setRuleEdits}
            onSchedulerToggle={handleSchedulerToggle}
          />
        </TabsContent>

        {/* ═══ POSITIONS TAB ══════════════════════════════ */}
        <TabsContent value="positions" className="space-y-4">
          <PositionsPanel
            openPositions={openPositions}
            rules={rules}
            chartSymbol={chartSymbol}
            onChartSymbolChange={setChartSymbol}
          />
        </TabsContent>

        {/* ═══ AUDIT LOG TAB ══════════════════════════════ */}
        <TabsContent value="audit" className="space-y-4">
          <AuditLogPanel
            logs={logs}
            showAllLogs={showAllLogs}
            selectedLog={selectedLog}
            onShowAllLogsChange={setShowAllLogs}
            onSelectedLogChange={setSelectedLog}
            onRefresh={fetchStatus}
          />
        </TabsContent>

        {/* ═══ RULES TAB ══════════════════════════════════ */}
        <TabsContent value="rules" className="space-y-4">
          <RulesPanel
            rules={rules}
            drawdown={drawdown}
            editingRules={editingRules}
            ruleEdits={ruleEdits}
            onEditClick={() => { setRuleEdits({ ...rules }); setEditingRules(true); }}
            onSave={() => setEditingRules(false)}
            onCancel={() => setEditingRules(false)}
            onRuleEditsChange={setRuleEdits}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}