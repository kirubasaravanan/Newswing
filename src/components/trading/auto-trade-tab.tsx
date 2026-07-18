'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Bot, Play, Wallet, Settings, TrendingUp, TrendingDown, Clock,
  ArrowRightLeft, Shield, AlertTriangle, CheckCircle2, XCircle,
  Wifi, WifiOff, Loader2, Plus, Minus, RefreshCw, Zap, Timer,
  ChevronDown, ChevronUp, Eye, FileText, Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTradeStore } from '@/store/trade-store';
import { TradingViewChart } from './tradingview-chart';

// ── Types ───────────────────────────────────────────────
interface WalletData {
  id: string; totalCapital: number; deployed: number; available: number;
  realizedPnl: number; unrealizedPnl: number;
}

interface PositionRules {
  maxPerStock: number; maxBuysPerMonth: number; maxHoldingDays: number;
  maxTotalPositions: number; riskPerTradePct: number;
  trailingStopR: number; trailToR: number; partialBookR: number; partialBookPct: number;
  cooldownDays: number; maxSectorPct: number; timeExitMins: number;
}

interface SchedulerState {
  enabled: boolean; scanIntervalMin: number; exitIntervalMin: number;
  lastScanAt: string | null; lastExitAt: string | null;
  todayEntries: number; todayExits: number; todayPnl: number; scanCount: number;
}

interface AutoTradeLog {
  id: string; action: string; symbol: string; executed: boolean;
  reason: string; createdAt: string; signal?: string;
}

interface OpenPosition {
  id: string; symbol: string; stockName: string | null;
  entryPrice: number; qty: number; stopLoss: number; targetPrice: number;
  entryDate: string; autoTraded: boolean; tags?: string;
}

export function AutoTradeTab() {
  const { config } = useTradeStore();
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [rules, setRules] = useState<PositionRules>({
    maxPerStock: 50000, maxBuysPerMonth: 3, maxHoldingDays: 25,
    maxTotalPositions: 8, riskPerTradePct: 1.0,
    trailingStopR: 1.5, trailToR: 0.5, partialBookR: 2.0, partialBookPct: 30,
    cooldownDays: 3, maxSectorPct: 35, timeExitMins: 30,
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
  const [ruleEdits, setRuleEdits] = useState<PositionRules>({ ...rules });
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  const [exitWarnings, setExitWarnings] = useState<any[]>([]);
  const [selectedLog, setSelectedLog] = useState<AutoTradeLog | null>(null);
  const [showAllLogs, setShowAllLogs] = useState(false);

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
      }
    } catch (err) { console.error('Fetch status error:', err); }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // ── Scheduler Tick (called periodically) ──────────────
  const schedulerTickRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (scheduler?.enabled && marketHours) {
      schedulerTickRef.current = setInterval(async () => {
        try {
          await fetch('/api/auto-trade', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'scheduler_tick' }),
          });
          fetchStatus(); // Refresh UI
        } catch { /* ignore */ }
      }, 60000); // Check every minute
    }
    return () => { if (schedulerTickRef.current) clearInterval(schedulerTickRef.current); };
  }, [scheduler?.enabled, marketHours, fetchStatus]);

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
        toast.success(`Scan Complete`, {
          description: `${data.totalScanned} scanned → ${data.l1Passed} L1 pass → ${data.l2Signals} entries, ${data.skipped.length} skipped`,
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
      const res = await fetch('/api/auto-trade', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_rules', rules: ruleEdits }),
      });
      const data = await res.json();
      if (data.success) { setRules(data.rules); setEditingRules(false); toast.success('Rules updated'); }
    } catch { toast.error('Failed to update rules'); }
  };

  const totalPnl = (wallet?.realizedPnl || 0) + (wallet?.unrealizedPnl || 0);
  const pnlPct = wallet?.totalCapital ? (totalPnl / (wallet.totalCapital - wallet.realizedPnl)) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* ── Top Bar ─────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Auto-Trade Engine
          </h2>
          {/* Market Status */}
          <div className={cn(
            'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs',
            marketHours ? 'bg-emerald-500/10 text-emerald-400' : 'bg-muted text-muted-foreground'
          )}>
            <div className={cn('h-1.5 w-1.5 rounded-full', marketHours ? 'bg-emerald-400 animate-pulse' : 'bg-muted-foreground')} />
            {marketHours ? `Market Open — ${timeToClose}m to close` : 'Market Closed'}
          </div>
          {/* Scheduler Armed Status */}
          <div className={cn(
            'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs',
            scheduler?.enabled ? 'bg-indigo-500/10 text-indigo-400' : 'bg-muted text-muted-foreground'
          )}>
            <Shield className="h-3 w-3" />
            {scheduler?.enabled ? 'Auto-Mode Armed' : 'Manual'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleCheckExits}
            disabled={checkingExits || openPositions.length === 0}
            className="h-8 gap-1.5 text-xs">
            {checkingExits ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRightLeft className="h-3 w-3" />}
            Check Exits
          </Button>
          <Button onClick={handleScanAndTrade} disabled={scanning || !marketHours}
            className={cn('gap-1.5', scheduler?.enabled ? 'bg-emerald-600 hover:bg-emerald-700' : '')}
            size="sm">
            {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            {scanning ? 'Scanning Universe...' : 'Scan & Auto-Trade'}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="engine" className="space-y-4">
        <TabsList className="bg-secondary/50">
          <TabsTrigger value="engine" className="text-xs gap-1.5"><Bot className="h-3 w-3" /> Engine</TabsTrigger>
          <TabsTrigger value="scheduler" className="text-xs gap-1.5"><Timer className="h-3 w-3" /> Scheduler</TabsTrigger>
          <TabsTrigger value="positions" className="text-xs gap-1.5"><TrendingUp className="h-3 w-3" /> Positions</TabsTrigger>
          <TabsTrigger value="audit" className="text-xs gap-1.5"><FileText className="h-3 w-3" /> Audit Log</TabsTrigger>
          <TabsTrigger value="rules" className="text-xs gap-1.5"><Settings className="h-3 w-3" /> Rules</TabsTrigger>
        </TabsList>

        {/* ── ENGINE TAB ──────────────────────────────────── */}
        <TabsContent value="engine" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Wallet Card */}
            <Card className="lg:col-span-2 border-border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Wallet className="h-4 w-4 text-primary" /> Capital Wallet
                  </h3>
                  {!editingWallet ? (
                    <Button variant="ghost" size="sm" onClick={() => { setWalletInput(String(wallet?.totalCapital || 200000)); setEditingWallet(true); }} className="h-7 text-xs">Edit</Button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Input value={walletInput} onChange={e => setWalletInput(e.target.value)} className="h-7 w-32 text-xs" />
                      <Button size="sm" onClick={saveWallet} className="h-7 text-xs">Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingWallet(false)} className="h-7 text-xs">Cancel</Button>
                    </div>
                  )}
                </div>
                {wallet && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="rounded-lg bg-secondary/50 p-3">
                      <div className="text-[10px] text-muted-foreground uppercase">Total Capital</div>
                      <div className="text-lg font-bold font-mono mt-0.5">₹{wallet.totalCapital.toLocaleString()}</div>
                    </div>
                    <div className="rounded-lg bg-blue-500/10 p-3">
                      <div className="text-[10px] text-blue-400 uppercase">Deployed</div>
                      <div className="text-lg font-bold font-mono mt-0.5 text-blue-400">₹{wallet.deployed.toLocaleString()}</div>
                      <div className="text-[10px] text-muted-foreground">{wallet.totalCapital > 0 ? ((wallet.deployed / wallet.totalCapital) * 100).toFixed(1) : 0}%</div>
                    </div>
                    <div className="rounded-lg bg-emerald-500/10 p-3">
                      <div className="text-[10px] text-emerald-400 uppercase">Available</div>
                      <div className="text-lg font-bold font-mono mt-0.5 text-emerald-400">₹{wallet.available.toLocaleString()}</div>
                    </div>
                    <div className={cn('rounded-lg p-3', totalPnl >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10')}>
                      <div className={cn('text-[10px] uppercase', totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>Total P&L</div>
                      <div className={cn('text-lg font-bold font-mono mt-0.5', totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {totalPnl >= 0 ? '+' : ''}₹{totalPnl.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        R: {wallet.realizedPnl.toLocaleString()} | U: {wallet.unrealizedPnl.toLocaleString()}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Today's Summary */}
            <Card className="border-border">
              <CardContent className="p-4">
                <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                  <Activity className="h-4 w-4 text-primary" /> Today&apos;s Summary
                </h3>
                {scheduler && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Total Scans</span>
                      <span className="font-mono font-bold">{scheduler.scanCount}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Entries Today</span>
                      <span className="font-mono font-bold text-emerald-400">{scheduler.todayEntries}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Exits Today</span>
                      <span className="font-mono font-bold text-red-400">{scheduler.todayExits}</span>
                    </div>
                    <div className="flex justify-between text-xs pt-2 border-t border-border/50">
                      <span className="text-muted-foreground">Today P&L</span>
                      <span className={cn('font-mono font-bold', scheduler.todayPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {scheduler.todayPnl >= 0 ? '+' : ''}₹{Math.round(scheduler.todayPnl).toLocaleString()}
                      </span>
                    </div>
                    {scheduler.lastScanAt && (
                      <div className="text-[10px] text-muted-foreground pt-1">
                        Last scan: {new Date(scheduler.lastScanAt).toLocaleTimeString()}
                      </div>
                    )}
                    {scheduler.lastExitAt && (
                      <div className="text-[10px] text-muted-foreground">
                        Last exit check: {new Date(scheduler.lastExitAt).toLocaleTimeString()}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Position Health Warnings */}
          {exitWarnings.length > 0 && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="p-4">
                <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  Position Warnings ({exitWarnings.length})
                </h3>
                <div className="space-y-1.5">
                  {exitWarnings.map((w: any, i: number) => (
                    <div key={i} className={cn(
                      'flex items-center gap-2 text-xs px-3 py-2 rounded-lg',
                      w.type === 'SL_PROXIMITY' ? 'bg-red-500/10' : 'bg-amber-500/10'
                    )}>
                      <Badge variant="outline" className={cn('text-[9px] h-4',
                        w.type === 'SL_PROXIMITY' ? 'text-red-400 border-red-500/30' : 'text-amber-400 border-amber-500/30'
                      )}>{w.type === 'SL_PROXIMITY' ? 'SL RISK' : 'AGING'}</Badge>
                      <span className="font-semibold">{w.symbol}</span>
                      <span className="text-muted-foreground">{w.message}</span>
                      <span className={cn('ml-auto font-mono', (w.pnlPercent || 0) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {w.pnlPercent >= 0 ? '+' : ''}{w.pnlPercent?.toFixed(2)}%
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── SCHEDULER TAB ──────────────────────────────── */}
        <TabsContent value="scheduler" className="space-y-4">
          <Card className="border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Timer className="h-4 w-4 text-primary" /> Automation Scheduler
                  </h3>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Automatically scans for entries and manages exits during market hours (9:15 AM - 3:30 PM IST)
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cn('text-xs', marketHours ? 'text-emerald-400' : 'text-muted-foreground')}>
                    {marketHours ? 'Market is OPEN' : 'Market is CLOSED'}
                  </span>
                  <Switch
                    checked={scheduler?.enabled || false}
                    onCheckedChange={handleSchedulerToggle}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg bg-secondary/50 p-4 space-y-3">
                  <h4 className="text-xs font-semibold flex items-center gap-2">
                    <Zap className="h-3 w-3 text-emerald-400" /> Entry Scan Settings
                  </h4>
                  <div className="flex items-center justify-between text-xs">
                    <Label className="text-muted-foreground">Scan every (minutes)</Label>
                    <Input type="number" value={ruleEdits.scanIntervalMin || 30}
                      onChange={e => setRuleEdits({ ...ruleEdits, scanIntervalMin: parseInt(e.target.value) || 30 })}
                      className="h-7 w-20 text-xs text-right" />
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    V-Swing universe scan will run automatically. New A+/B signals will be entered if rules permit.
                  </p>
                </div>

                <div className="rounded-lg bg-secondary/50 p-4 space-y-3">
                  <h4 className="text-xs font-semibold flex items-center gap-2">
                    <ArrowRightLeft className="h-3 w-3 text-red-400" /> Exit Check Settings
                  </h4>
                  <div className="flex items-center justify-between text-xs">
                    <Label className="text-muted-foreground">Check every (minutes)</Label>
                    <Input type="number" value={ruleEdits.exitIntervalMin || 5}
                      onChange={e => setRuleEdits({ ...ruleEdits, exitIntervalMin: parseInt(e.target.value) || 5 })}
                      className="h-7 w-20 text-xs text-right" />
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Monitors SL/TP hits, trailing stops, time-based exits, and partial bookings.
                  </p>
                </div>
              </div>

              {/* Scheduler Timeline */}
              {scheduler && (
                <div className="mt-4 rounded-lg bg-secondary/30 p-3">
                  <h4 className="text-[10px] text-muted-foreground uppercase mb-2">Timeline</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Last Scan</span>
                      <div className="font-mono text-[11px]">{scheduler.lastScanAt ? new Date(scheduler.lastScanAt).toLocaleTimeString() : '--'}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Last Exit Check</span>
                      <div className="font-mono text-[11px]">{scheduler.lastExitAt ? new Date(scheduler.lastExitAt).toLocaleTimeString() : '--'}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Status</span>
                      <div className={cn('font-mono text-[11px]', scheduler.enabled ? 'text-emerald-400' : 'text-muted-foreground')}>
                        {scheduler.enabled ? 'ARMED' : 'DISARMED'}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Market</span>
                      <div className={cn('font-mono text-[11px]', marketHours ? 'text-emerald-400' : 'text-red-400')}>
                        {marketHours ? 'OPEN' : 'CLOSED'}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── POSITIONS TAB ──────────────────────────────── */}
        <TabsContent value="positions" className="space-y-4">
          <Card className="border-border">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <TrendingUp className="h-4 w-4" /> Open Auto-Positions ({openPositions.length})
              </h3>
              {openPositions.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-xs text-muted-foreground">No open positions. Run Scan & Auto-Trade to find entries.</p>
                </div>
              ) : (
                <ScrollArea className="max-h-[400px]">
                  <div className="space-y-2 pr-2">
                    {openPositions.map(pos => {
                      const days = Math.floor((Date.now() - new Date(pos.entryDate).getTime()) / 86400000);
                      const risk = pos.entryPrice - pos.stopLoss;
                      const agePct = rules.maxHoldingDays > 0 ? (days / rules.maxHoldingDays) * 100 : 0;
                      const isPartial = pos.tags?.includes('partial-booked');
                      return (
                        <div key={pos.id}
                          className={cn(
                            'rounded-lg p-3 cursor-pointer hover:bg-secondary/80 transition',
                            agePct >= 80 ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-secondary/50'
                          )}
                          onClick={() => setChartSymbol(pos.symbol)}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm">{pos.symbol}</span>
                              <Badge variant="outline" className="text-[10px] h-4">AUTO</Badge>
                              {isPartial && <Badge variant="outline" className="text-[10px] h-4 text-amber-400 border-amber-500/30">PARTIAL</Badge>}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={cn('text-[10px]', agePct >= 80 ? 'text-amber-400 font-bold' : 'text-muted-foreground')}>
                                {days}/{rules.maxHoldingDays}d
                              </span>
                              <span className="text-xs font-mono">₹{pos.entryPrice}</span>
                              <span className="text-[10px] text-muted-foreground">x{pos.qty}</span>
                            </div>
                          </div>
                          <div className="mt-2 flex items-center gap-4 text-[10px]">
                            <span className="text-red-400">SL: ₹{pos.stopLoss}</span>
                            <span className="text-emerald-400">TP: ₹{pos.targetPrice}</span>
                            <span className="text-muted-foreground">
                              Risk: ₹{risk > 0 ? (risk * pos.qty).toLocaleString() : 'N/A'}
                            </span>
                            <span className="text-muted-foreground">
                              {risk > 0 ? `R:R ${(Math.abs(pos.targetPrice - pos.entryPrice) / risk).toFixed(1)}x` : ''}
                            </span>
                          </div>
                          {/* Aging bar */}
                          {agePct >= 50 && (
                            <div className="mt-2 h-1 rounded-full bg-secondary overflow-hidden">
                              <div className={cn('h-full rounded-full transition-all', agePct >= 80 ? 'bg-amber-400' : 'bg-blue-400')}
                                style={{ width: `${Math.min(100, agePct)}%` }} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          {/* Chart */}
          {chartSymbol && (
            <Card className="border-border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold">{chartSymbol} — TradingView Chart</h3>
                  <Button variant="ghost" size="sm" onClick={() => setChartSymbol(null)} className="h-7 text-xs">Close</Button>
                </div>
                <TradingViewChart symbol={chartSymbol} height={450} />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── AUDIT LOG TAB ──────────────────────────────── */}
        <TabsContent value="audit" className="space-y-4">
          <Card className="border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" /> Execution Audit Log
                </h3>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowAllLogs(!showAllLogs)} className="h-7 text-xs gap-1">
                    {showAllLogs ? 'Show Recent' : 'Show All'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={fetchStatus} className="h-7 text-xs gap-1">
                    <RefreshCw className="h-3 w-3" /> Refresh
                  </Button>
                </div>
              </div>
              <ScrollArea className="max-h-[500px]">
                <div className="space-y-1 pr-2">
                  {(showAllLogs ? logs : logs.slice(0, 30)).map((log) => {
                    const isEntry = log.action.includes('ENTRY');
                    const isExit = log.action.includes('EXIT');
                    const isPartial = log.action === 'PARTIAL_BOOK';
                    return (
                      <div key={log.id}
                        className={cn(
                          'flex items-start gap-2 text-xs py-2 px-2 rounded-lg hover:bg-secondary/30 cursor-pointer border-b border-border/30 last:border-0',
                        )}
                        onClick={() => setSelectedLog(log)}>
                        <div className="mt-0.5 shrink-0">
                          {isEntry ? <Plus className="h-3 w-3 text-emerald-400" /> :
                           isPartial ? <Minus className="h-3 w-3 text-amber-400" /> :
                           isExit ? <XCircle className="h-3 w-3 text-red-400" /> :
                           <RefreshCw className="h-3 w-3 text-muted-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold">{log.symbol}</span>
                            <Badge variant="outline" className={cn('text-[9px] h-3.5 px-1',
                              isEntry ? 'text-emerald-400' : isPartial ? 'text-amber-400' : isExit ? 'text-red-400' : 'text-muted-foreground'
                            )}>
                              {log.action.replace('AUTO_', '')}
                            </Badge>
                            {log.executed ? <CheckCircle2 className="h-3 w-3 text-emerald-400/50" /> : <XCircle className="h-3 w-3 text-red-400/50" />}
                          </div>
                          <p className="text-muted-foreground truncate">{log.reason}</p>
                        </div>
                        <span className="text-muted-foreground shrink-0 text-[10px]">
                          {new Date(log.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── RULES TAB ──────────────────────────────────── */}
        <TabsContent value="rules" className="space-y-4">
          <Card className="border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Settings className="h-4 w-4" /> Position Rules
                </h3>
                {!editingRules ? (
                  <Button variant="ghost" size="sm" onClick={() => { setRuleEdits({ ...rules }); setEditingRules(true); }} className="h-7 text-xs">Edit</Button>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveRules} className="h-7 text-xs">Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingRules(false)} className="h-7 text-xs">Cancel</Button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Position Sizing Rules */}
                <div className="space-y-2">
                  <h4 className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Position Sizing</h4>
                  {editingRules ? [
                    { key: 'maxPerStock', label: 'Max per Stock (₹)', type: 'number' },
                    { key: 'maxTotalPositions', label: 'Max Total Positions', type: 'number' },
                    { key: 'riskPerTradePct', label: 'Risk per Trade (%)', type: 'number' },
                    { key: 'maxBuysPerMonth', label: 'Max Buys/Month/Stock', type: 'number' },
                    { key: 'maxSectorPct', label: 'Max Sector Concentration (%)', type: 'number' },
                  ].map(f => (
                    <div key={f.key} className="flex items-center justify-between text-xs">
                      <Label className="text-muted-foreground">{f.label}</Label>
                      <Input type={f.type} value={(ruleEdits as any)[f.key]}
                        onChange={e => setRuleEdits({ ...ruleEdits, [f.key]: f.type === 'number' ? (parseFloat(e.target.value) || 0) : e.target.value })}
                        className="h-7 w-24 text-xs text-right" />
                    </div>
                  )) : [
                    { l: 'Max/Stock', v: `₹${rules.maxPerStock.toLocaleString()}` },
                    { l: 'Max Positions', v: String(rules.maxTotalPositions) },
                    { l: 'Risk/Trade', v: `${rules.riskPerTradePct}%` },
                    { l: 'Buys/Month', v: String(rules.maxBuysPerMonth) },
                    { l: 'Sector Cap', v: `${rules.maxSectorPct}%` },
                  ].map(r => (
                    <div key={r.l} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{r.l}</span><span className="font-mono">{r.v}</span>
                    </div>
                  ))}
                </div>

                {/* Exit Management Rules */}
                <div className="space-y-2">
                  <h4 className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Exit Management</h4>
                  {editingRules ? [
                    { key: 'maxHoldingDays', label: 'Max Holding Days' },
                    { key: 'trailingStopR', label: 'Trail Start (R-multiple)' },
                    { key: 'trailToR', label: 'Trail To (R-multiple)' },
                    { key: 'partialBookR', label: 'Partial Book At (R)' },
                    { key: 'partialBookPct', label: 'Partial Book %' },
                    { key: 'cooldownDays', label: 'Re-entry Cooldown (days)' },
                    { key: 'timeExitMins', label: 'Time Exit Before Close (min)' },
                  ].map(f => (
                    <div key={f.key} className="flex items-center justify-between text-xs">
                      <Label className="text-muted-foreground">{f.label}</Label>
                      <Input type="number" value={(ruleEdits as any)[f.key]}
                        onChange={e => setRuleEdits({ ...ruleEdits, [f.key]: parseFloat(e.target.value) || 0 })}
                        className="h-7 w-24 text-xs text-right" />
                    </div>
                  )) : [
                    { l: 'Max Holding', v: `${rules.maxHoldingDays} days` },
                    { l: 'Trail Start', v: `${rules.trailingStopR}R profit` },
                    { l: 'Trail To', v: `${rules.trailToR}R level` },
                    { l: 'Partial Book', v: `${rules.partialBookPct}% at ${rules.partialBookR}R` },
                    { l: 'Cooldown', v: `${rules.cooldownDays} days` },
                    { l: 'Time Exit', v: `${rules.timeExitMins}min before close` },
                  ].map(r => (
                    <div key={r.l} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{r.l}</span><span className="font-mono">{r.v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Log Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {selectedLog?.symbol} — {selectedLog?.action.replace('AUTO_', '')}
            </DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded bg-secondary/50 p-2">
                  <div className="text-[10px] text-muted-foreground">Action</div>
                  <div className="font-mono">{selectedLog.action}</div>
                </div>
                <div className="rounded bg-secondary/50 p-2">
                  <div className="text-[10px] text-muted-foreground">Executed</div>
                  <div className={selectedLog.executed ? 'text-emerald-400' : 'text-red-400'}>
                    {selectedLog.executed ? 'Yes' : 'No'}
                  </div>
                </div>
                <div className="rounded bg-secondary/50 p-2 col-span-2">
                  <div className="text-[10px] text-muted-foreground">Time</div>
                  <div className="font-mono">{new Date(selectedLog.createdAt).toLocaleString()}</div>
                </div>
              </div>
              <div className="rounded bg-secondary/50 p-2">
                <div className="text-[10px] text-muted-foreground mb-1">Reason</div>
                <div className="text-[11px]">{selectedLog.reason}</div>
              </div>
              {selectedLog.signal && (
                <div className="rounded bg-secondary/50 p-2">
                  <div className="text-[10px] text-muted-foreground mb-1">Signal Details</div>
                  <pre className="text-[10px] text-muted-foreground overflow-auto max-h-[200px] whitespace-pre-wrap">
                    {JSON.stringify(JSON.parse(selectedLog.signal), null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost" size="sm">Close</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}