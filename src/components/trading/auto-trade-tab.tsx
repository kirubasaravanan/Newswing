'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import {
  Bot, Play, Wallet, Settings, TrendingUp, TrendingDown, Clock,
  ArrowRightLeft, Shield, AlertTriangle, CheckCircle2, XCircle,
  Database, Wifi, WifiOff, Loader2, Plus, Minus, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTradeStore } from '@/store/trade-store';
import { TradingViewChart } from './tradingview-chart';

interface WalletData {
  id: string;
  totalCapital: number;
  deployed: number;
  available: number;
  realizedPnl: number;
  unrealizedPnl: number;
}

interface PositionRules {
  maxPerStock: number;
  maxBuysPerMonth: number;
  maxHoldingDays: number;
  maxTotalPositions: number;
  riskPerTradePct: number;
}

interface AutoTradeLog {
  id: string;
  action: string;
  symbol: string;
  executed: boolean;
  reason: string;
  createdAt: string;
}

interface OpenPosition {
  id: string;
  symbol: string;
  stockName: string | null;
  entryPrice: number;
  qty: number;
  stopLoss: number;
  targetPrice: number;
  entryDate: string;
  autoTraded: boolean;
}

export function AutoTradeTab() {
  const { config } = useTradeStore();
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [rules, setRules] = useState<PositionRules>({
    maxPerStock: 50000, maxBuysPerMonth: 3, maxHoldingDays: 25,
    maxTotalPositions: 8, riskPerTradePct: 1.0,
  });
  const [openPositions, setOpenPositions] = useState<OpenPosition[]>([]);
  const [logs, setLogs] = useState<AutoTradeLog[]>([]);
  const [autoMode, setAutoMode] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [checkingExits, setCheckingExits] = useState(false);
  const [editingWallet, setEditingWallet] = useState(false);
  const [walletInput, setWalletInput] = useState('200000');
  const [editingRules, setEditingRules] = useState(false);
  const [ruleEdits, setRuleEdits] = useState<PositionRules>({ ...rules });
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  const [dataProvider, setDataProvider] = useState<{ source: string; yahooAvailable: boolean; symbolsCached: number } | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/auto-trade');
      const data = await res.json();
      if (data.success) {
        setWallet(data.wallet);
        setRules(data.rules);
        setOpenPositions(data.openTrades);
        setLogs(data.recentLogs);
      }
    } catch (err) {
      console.error('Fetch status error:', err);
    }
  }, []);

  const fetchDataProvider = useCallback(async () => {
    try {
      const res = await fetch('/api/data-status');
      const data = await res.json();
      if (data.success) {
        setDataProvider(data.provider);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchDataProvider();
    const interval = setInterval(fetchStatus, 60000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchDataProvider]);

  const handleScanAndTrade = async () => {
    setScanning(true);
    try {
      const res = await fetch('/api/auto-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scan_and_trade', config }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Auto-Trade Complete`, {
          description: `${data.entries.length} entries, ${data.skipped.length} skipped`,
        });
        fetchStatus();
      } else {
        toast.error('Auto-trade failed', { description: data.error });
      }
    } catch {
      toast.error('Auto-trade failed');
    } finally {
      setScanning(false);
    }
  };

  const handleCheckExits = async () => {
    setCheckingExits(true);
    try {
      const res = await fetch('/api/auto-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check_exits' }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.exits.length > 0) {
          toast.success(`Exit Check: ${data.exits.length} positions closed`, {
            description: data.exits.map((e: any) => `${e.symbol} (${e.exitReason})`).join(', '),
          });
        } else {
          toast.info('No exits triggered', { description: `${data.holding.length} positions still holding` });
        }
        fetchStatus();
      }
    } catch {
      toast.error('Exit check failed');
    } finally {
      setCheckingExits(false);
    }
  };

  const saveWallet = async () => {
    try {
      const res = await fetch('/api/auto-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_wallet', totalCapital: parseFloat(walletInput) }),
      });
      const data = await res.json();
      if (data.success) {
        setWallet(data.wallet);
        setEditingWallet(false);
        toast.success('Wallet updated');
      }
    } catch {
      toast.error('Failed to update wallet');
    }
  };

  const saveRules = async () => {
    try {
      const res = await fetch('/api/auto-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_rules', rules: ruleEdits }),
      });
      const data = await res.json();
      if (data.success) {
        setRules(data.rules);
        setEditingRules(false);
        toast.success('Rules updated');
      }
    } catch {
      toast.error('Failed to update rules');
    }
  };

  const totalPnl = (wallet?.realizedPnl || 0) + (wallet?.unrealizedPnl || 0);
  const pnlPct = wallet?.totalCapital ? (totalPnl / (wallet.totalCapital - wallet.realizedPnl)) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Top Bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Auto-Trading Engine
          </h2>
          <div className={cn(
            'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs',
            autoMode ? 'bg-emerald-500/10 text-emerald-400' : 'bg-muted text-muted-foreground'
          )}>
            <div className={cn('h-1.5 w-1.5 rounded-full', autoMode ? 'bg-emerald-400 animate-pulse' : 'bg-muted-foreground')} />
            {autoMode ? 'Armed' : 'Manual'}
          </div>
          {dataProvider && (
            <Badge variant="outline" className="text-[10px] h-5 gap-1">
              {dataProvider.yahooAvailable ? <Wifi className="h-2.5 w-2.5 text-emerald-400" /> : <WifiOff className="h-2.5 w-2.5 text-amber-400" />}
              {dataProvider.source === 'yahoo' ? 'Yahoo Finance' : 'Error'}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCheckExits}
            disabled={checkingExits || openPositions.length === 0}
            className="h-8 gap-1.5 text-xs"
          >
            {checkingExits ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRightLeft className="h-3 w-3" />}
            Check Exits
          </Button>
          <Button
            onClick={handleScanAndTrade}
            disabled={scanning}
            className={cn('gap-1.5', autoMode ? 'bg-emerald-600 hover:bg-emerald-700' : '')}
            size="sm"
          >
            {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
            {scanning ? 'Scanning Universe...' : 'Scan & Auto-Trade'}
          </Button>
        </div>
      </div>

      {/* Wallet + Rules Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Wallet Card */}
        <Card className="lg:col-span-2 border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Wallet className="h-4 w-4 text-primary" />
                Capital Wallet
              </h3>
              {!editingWallet ? (
                <Button variant="ghost" size="sm" onClick={() => { setWalletInput(String(wallet?.totalCapital || 200000)); setEditingWallet(true); }} className="h-7 text-xs">
                  Edit
                </Button>
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
                  <div className="text-lg font-bold font-mono mt-0.5">₹{(wallet.totalCapital).toLocaleString()}</div>
                </div>
                <div className="rounded-lg bg-blue-500/10 p-3">
                  <div className="text-[10px] text-blue-400 uppercase">Deployed</div>
                  <div className="text-lg font-bold font-mono mt-0.5 text-blue-400">₹{wallet.deployed.toLocaleString()}</div>
                  <div className="text-[10px] text-muted-foreground">{wallet.totalCapital > 0 ? ((wallet.deployed / wallet.totalCapital) * 100).toFixed(1) : 0}% utilized</div>
                </div>
                <div className="rounded-lg bg-emerald-500/10 p-3">
                  <div className="text-[10px] text-emerald-400 uppercase">Available</div>
                  <div className="text-lg font-bold font-mono mt-0.5 text-emerald-400">₹{wallet.available.toLocaleString()}</div>
                </div>
                <div className={cn('rounded-lg p-3', totalPnl >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10')}>
                  <div className={cn('text-[10px] uppercase', totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    Total P&L
                  </div>
                  <div className={cn('text-lg font-bold font-mono mt-0.5', totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {totalPnl >= 0 ? '+' : ''}₹{totalPnl.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Realized: ₹{wallet.realizedPnl.toLocaleString()} | Unreal: ₹{wallet.unrealizedPnl.toLocaleString()}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Position Rules Card */}
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Shield className="h-4 w-4 text-amber-400" />
                Position Rules
              </h3>
              <Button variant="ghost" size="sm" onClick={() => { setRuleEdits({ ...rules }); setEditingRules(true); }} className="h-7 text-xs">
                Edit
              </Button>
            </div>
            {editingRules ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <Label className="text-muted-foreground">Max/Stock</Label>
                  <Input value={ruleEdits.maxPerStock} onChange={e => setRuleEdits({ ...ruleEdits, maxPerStock: parseInt(e.target.value) || 0 })} className="h-7 w-24 text-xs text-right" />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <Label className="text-muted-foreground">Max Buys/Month</Label>
                  <Input value={ruleEdits.maxBuysPerMonth} onChange={e => setRuleEdits({ ...ruleEdits, maxBuysPerMonth: parseInt(e.target.value) || 0 })} className="h-7 w-24 text-xs text-right" />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <Label className="text-muted-foreground">Max Holding Days</Label>
                  <Input value={ruleEdits.maxHoldingDays} onChange={e => setRuleEdits({ ...ruleEdits, maxHoldingDays: parseInt(e.target.value) || 0 })} className="h-7 w-24 text-xs text-right" />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <Label className="text-muted-foreground">Max Positions</Label>
                  <Input value={ruleEdits.maxTotalPositions} onChange={e => setRuleEdits({ ...ruleEdits, maxTotalPositions: parseInt(e.target.value) || 0 })} className="h-7 w-24 text-xs text-right" />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <Label className="text-muted-foreground">Risk/Trade %</Label>
                  <Input value={ruleEdits.riskPerTradePct} onChange={e => setRuleEdits({ ...ruleEdits, riskPerTradePct: parseFloat(e.target.value) || 0 })} className="h-7 w-24 text-xs text-right" />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" onClick={saveRules} className="h-7 text-xs flex-1">Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingRules(false)} className="h-7 text-xs">Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Max/Stock</span><span className="font-mono">₹{rules.maxPerStock.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Max Buys/Month</span><span className="font-mono">{rules.maxBuysPerMonth}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Max Holding</span><span className="font-mono">{rules.maxHoldingDays} days</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Max Positions</span><span className="font-mono">{rules.maxTotalPositions}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Risk/Trade</span><span className="font-mono">{rules.riskPerTradePct}%</span></div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Open Positions + Activity Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Open Positions */}
        <Card className="border-border">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4" />
              Open Auto-Positions ({openPositions.length})
            </h3>
            {openPositions.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">
                No open positions. Click &quot;Scan & Auto-Trade&quot; to find and enter positions.
              </p>
            ) : (
              <ScrollArea className="max-h-[300px]">
                <div className="space-y-2 pr-2">
                  {openPositions.map(pos => {
                    const days = Math.floor((Date.now() - new Date(pos.entryDate).getTime()) / 86400000);
                    return (
                      <div
                        key={pos.id}
                        className="rounded-lg bg-secondary/50 p-3 cursor-pointer hover:bg-secondary transition"
                        onClick={() => setChartSymbol(pos.symbol)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">{pos.symbol}</span>
                            <Badge variant="outline" className="text-[10px] h-4">AUTO</Badge>
                            <span className="text-[10px] text-muted-foreground">{days}d</span>
                          </div>
                          <div className="text-right text-xs">
                            <div className="font-mono">₹{pos.entryPrice}</div>
                            <div className="text-muted-foreground">x{pos.qty}</div>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center gap-3 text-[10px]">
                          <span className="text-red-400">SL: ₹{pos.stopLoss}</span>
                          <span className="text-emerald-400">TP: ₹{pos.targetPrice}</span>
                          <span className="text-muted-foreground">Invested: ₹{(pos.entryPrice * pos.qty).toLocaleString()}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* Activity Log */}
        <Card className="border-border">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
              <Clock className="h-4 w-4" />
              Activity Log
            </h3>
            {logs.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No activity yet.</p>
            ) : (
              <ScrollArea className="max-h-[300px]">
                <div className="space-y-1.5 pr-2">
                  {logs.slice(0, 30).map(log => {
                    const isEntry = log.action.includes('ENTRY');
                    const isExit = log.action.includes('EXIT');
                    return (
                      <div key={log.id} className="flex items-start gap-2 text-xs py-1.5 border-b border-border/50 last:border-0">
                        <div className="mt-0.5">
                          {isEntry ? <Plus className="h-3 w-3 text-emerald-400" /> :
                           isExit ? <Minus className="h-3 w-3 text-red-400" /> :
                           <RefreshCw className="h-3 w-3 text-muted-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold">{log.symbol}</span>
                            <Badge variant="outline" className="text-[9px] h-3.5 px-1">
                              {log.action.replace('AUTO_', '')}
                            </Badge>
                          </div>
                          <p className="text-muted-foreground truncate">{log.reason}</p>
                        </div>
                        <span className="text-muted-foreground shrink-0">
                          {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {/* TradingView Chart (when a position is clicked) */}
      {chartSymbol && (
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">{chartSymbol} — TradingView Chart</h3>
              <Button variant="ghost" size="sm" onClick={() => setChartSymbol(null)} className="h-7 text-xs">
                Close
              </Button>
            </div>
            <TradingViewChart symbol={chartSymbol} height={450} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}