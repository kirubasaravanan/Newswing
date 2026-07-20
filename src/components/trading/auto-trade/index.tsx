'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTradeStore } from '@/store/trade-store';
import {
  Bot, ArrowRightLeft, Shield, TrendingUp, ShieldAlert, RotateCcw,
  Loader2, Zap, Timer, Settings, FileText,
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
  const [walletInput, setWalletInput] = useState('200000');
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

  // ── Scheduler Tick ─────────────────────────────────────
  const schedulerTickRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (scheduler?.enabled && marketHours && !scheduler?.circuitBreaker) {
      schedulerTickRef.current = setInterval(async () => {
        try {
          await fetch('/api/auto-trade', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'scheduler_tick' }),
          });
          fetchStatus();
        } catch { /* ignore */ }
      }, 60000);
    }
    return () => { if (schedulerTickRef.current) clearInterval(schedulerTickRef.current); };
  }, [scheduler?.enabled, marketHours, scheduler?.circuitBreaker, fetchStatus]);

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
        const extra = data.circuitBreaker ? ' [CIRCUIT BREAKER]' :
          data.niftyRegime === 'BEARISH' ? ' [BEARISH REGIME]' : '';
        toast.success(`Scan Complete${extra}`, {
          description: `${data.totalScanned} scanned | ${data.l1Passed} L1 | ${data.l2Signals} entries | ${data.skipped.length} skipped`,
        });
        if (data.adaptiveFactor && data.adaptiveFactor < 1) {
          toast.info('Adaptive Sizing Active', {
            description: `Factor: ${(data.adaptiveFactor * 100).toFixed(0)}% (${data.consecutiveLosses} consecutive losses)`,
          });
        }
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
        if (data.partialBooks?.length > 0) {
          toast.info(`Partial Book: ${data.partialBooks.length} positions`, {
            description: data.partialBooks.map((p: any) => `${p.symbol}: ${p.bookedQty}qty at ${p.rMultiple}R`).join(', '),
          });
        }
        if (data.exits.length === 0 && (!data.partialBooks || data.partialBooks.length === 0)) {
          toast.info('No exits triggered', { description: `${data.holding?.length || 0} positions holding` });
        }
        if (data.warnings?.length > 0) setExitWarnings(data.warnings);
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

  const saveWallet = async () => {
    try {
      const res = await fetch('/api/auto-trade', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_wallet', totalCapital: parseFloat(walletInput) }),
      });
      const data = await res.json();
      if (data.success) { setWallet(data.wallet); setEditingWallet(false); toast.success('Wallet updated'); }
    } catch { toast.error('Failed to update wallet'); }
  };

  const saveRules = async () => {
    try {
      // Separate scheduler settings from rules
      const { scanIntervalMin, exitIntervalMin, ...rulesOnly } = ruleEdits;
      const res = await fetch('/api/auto-trade', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_rules', rules: rulesOnly }),
      });
      const data = await res.json();
      if (data.success) { setRules(data.rules); setEditingRules(false); toast.success('Rules updated'); }
    } catch { toast.error('Failed to update rules'); }
  };

  return (
    <div className="space-y-4">
      {/* ── Top Bar ─────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Auto-Trade Engine
            <Badge variant="outline" className="text-[9px] h-4 text-muted-foreground">v2</Badge>
          </h2>
          {/* Market Status */}
          <div className={cn(
            'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs',
            marketHours ? 'bg-emerald-500/10 text-emerald-400' : 'bg-muted text-muted-foreground'
          )}>
            <div className={cn('h-1.5 w-1.5 rounded-full', marketHours ? 'bg-emerald-400 animate-pulse' : 'bg-muted-foreground')} />
            {marketHours ? `${timeToClose}m to close` : 'Market Closed'}
          </div>
          {/* Circuit Breaker */}
          {scheduler?.circuitBreaker && (
            <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs bg-red-500/15 text-red-400 border border-red-500/20">
              <ShieldAlert className="h-3 w-3" />
              CIRCUIT BREAKER
              <Button variant="ghost" size="sm" onClick={handleResetCircuitBreaker} className="h-4 w-4 p-0 ml-1 text-red-400 hover:text-red-300">
                <RotateCcw className="h-2.5 w-2.5" />
              </Button>
            </div>
          )}
          {/* Nifty Regime */}
          <div className={cn(
            'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs',
            scheduler?.niftyRegime === 'BULLISH' ? 'bg-emerald-500/10 text-emerald-400' :
            scheduler?.niftyRegime === 'BEARISH' ? 'bg-red-500/10 text-red-400' : 'bg-muted text-muted-foreground'
          )}>
            <TrendingUp className={cn('h-3 w-3', scheduler?.niftyRegime === 'BEARISH' && 'rotate-180')} />
            {scheduler?.niftyRegime || 'UNKNOWN'}
          </div>
          {/* Auto-Mode */}
          <div className={cn(
            'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs',
            scheduler?.enabled ? 'bg-indigo-500/10 text-indigo-400' : 'bg-muted text-muted-foreground'
          )}>
            <Shield className="h-3 w-3" />
            {scheduler?.enabled ? 'Armed' : 'Manual'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleCheckExits}
            disabled={checkingExits || openPositions.length === 0}
            className="h-8 gap-1.5 text-xs">
            {checkingExits ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRightLeft className="h-3 w-3" />}
            Check Exits
          </Button>
          <Button onClick={handleScanAndTrade} disabled={scanning || !marketHours || !!scheduler?.circuitBreaker}
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
          <TabsTrigger value="scheduler" className="text-xs gap-1.5"><Timer className="h-3 w-3" /> Scheduler</TabsTrigger>
          <TabsTrigger value="positions" className="text-xs gap-1.5"><TrendingUp className="h-3 w-3" /> Positions</TabsTrigger>
          <TabsTrigger value="audit" className="text-xs gap-1.5"><FileText className="h-3 w-3" /> Audit</TabsTrigger>
          <TabsTrigger value="rules" className="text-xs gap-1.5"><Settings className="h-3 w-3" /> Rules</TabsTrigger>
        </TabsList>

        {/* ═══ ENGINE TAB ═════════════════════════════════ */}
        <TabsContent value="engine" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <WalletPanel
              wallet={wallet}
              rules={rules}
              drawdown={drawdown}
              editingWallet={editingWallet}
              walletInput={walletInput}
              onEditClick={() => { setWalletInput(String(wallet?.totalCapital || 200000)); setEditingWallet(true); }}
              onWalletInputChange={setWalletInput}
              onSave={saveWallet}
              onCancel={() => setEditingWallet(false)}
            />

            <EngineStateCard
              scheduler={scheduler}
              rules={rules}
              onResetCircuitBreaker={handleResetCircuitBreaker}
            />
          </div>

          <PositionWarnings exitWarnings={exitWarnings} />
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
            onSave={saveRules}
            onCancel={() => setEditingRules(false)}
            onRuleEditsChange={setRuleEdits}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}