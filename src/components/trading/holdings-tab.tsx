'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Plus, TrendingUp, TrendingDown, Minus, RefreshCw,
  ChevronDown, ChevronUp, LineChart, X, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { TradingViewChart } from './tradingview-chart';

interface Position {
  id: string; symbol: string; stockName: string | null; direction: string;
  entryPrice: number; qty: number; stopLoss: number; targetPrice: number;
  entryDate: string; autoTraded: boolean;
  currentPrice: number; pnl: number; pnlPercent: number;
  invested: number; currentValue: number; previousClose: number;
}

interface ClosedTrade {
  id: string; symbol: string; stockName: string | null; direction: string;
  entryDate: string; entryPrice: number; qty: number;
  exitDate: string | null; exitPrice: number | null;
  pnl: number | null; pnlPercent: number | null;
  exitReason: string | null; status: string;
}

export function HoldingsTab() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const [sellTarget, setSellTarget] = useState<Position | null>(null);
  const [sellPrice, setSellPrice] = useState('');
  const [sellReason, setSellReason] = useState('MANUAL');

  // Add position form
  const [form, setForm] = useState({
    symbol: '', stockName: '', direction: 'LONG',
    entryPrice: '', qty: '', stopLoss: '', targetPrice: '', notes: '',
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, tradesRes] = await Promise.all([
        fetch('/api/portfolio/summary'),
        fetch('/api/trades'),
      ]);
      const sum = await sumRes.json();
      const trades = await tradesRes.json();
      if (sum.success) setPositions(sum.positions || []);
      if (trades.success) {
        setClosedTrades((trades.trades || [])
          .filter((t: any) => t.status === 'CLOSED')
          .sort((a: any, b: any) => new Date(b.exitDate || 0).getTime() - new Date(a.exitDate || 0).getTime()));
      }
    } catch (err) {
      console.error('Holdings fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAdd = async () => {
    if (!form.symbol || !form.entryPrice || !form.qty || !form.stopLoss || !form.targetPrice) {
      toast.error('Fill all required fields');
      return;
    }
    try {
      const res = await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: form.symbol.toUpperCase(),
          stockName: form.stockName || null,
          direction: form.direction,
          entryPrice: parseFloat(form.entryPrice),
          qty: parseInt(form.qty),
          stopLoss: parseFloat(form.stopLoss),
          targetPrice: parseFloat(form.targetPrice),
          notes: form.notes || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`${form.symbol.toUpperCase()} added to portfolio`);
        setForm({ symbol: '', stockName: '', direction: 'LONG', entryPrice: '', qty: '', stopLoss: '', targetPrice: '', notes: '' });
        setAddOpen(false);
        fetchData();
      } else {
        toast.error('Failed to add position', { description: data.error });
      }
    } catch {
      toast.error('Failed to add position');
    }
  };

  const handleSell = async () => {
    if (!sellTarget || !sellPrice) return;
    try {
      const res = await fetch('/api/trades', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: sellTarget.id,
          exitDate: new Date().toISOString(),
          exitPrice: parseFloat(sellPrice),
          status: 'CLOSED',
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`${sellTarget.symbol} sold at ₹${parseFloat(sellPrice).toLocaleString()}`);
        setSellOpen(false);
        setSellTarget(null);
        setSellPrice('');
        fetchData();
      }
    } catch {
      toast.error('Failed to close position');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center text-muted-foreground">
          <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin" />
          <p className="text-sm">Loading holdings...</p>
        </div>
      </div>
    );
  }

  const totalInvested = positions.reduce((s, p) => s + p.invested, 0);
  const totalCurrent = positions.reduce((s, p) => s + p.currentValue, 0);
  const totalPnl = positions.reduce((s, p) => s + p.pnl, 0);
  const realized = closedTrades.reduce((s, t) => s + (t.pnl || 0), 0);
  const wins = closedTrades.filter(t => (t.pnl || 0) > 0);
  const bestPos = positions.length > 0 ? [...positions].sort((a, b) => b.pnlPercent - a.pnlPercent)[0] : null;
  const worstPos = positions.length > 0 ? [...positions].sort((a, b) => a.pnlPercent - b.pnlPercent)[0] : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-indigo-400" />
            Portfolio Holdings
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs py-1 px-2.5 bg-emerald-500/10 text-emerald-400 border-emerald-500/20 font-medium">
            100% Autonomous Engine Active
          </Badge>
          <Button variant="outline" size="sm" onClick={fetchData} className="h-8 gap-1.5 text-xs">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Summary Strip */}
      {positions.length > 0 && (
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
          {[
            { label: 'Positions', value: String(positions.length), color: '' },
            { label: 'Invested', value: `₹${Math.round(totalInvested).toLocaleString()}`, color: '' },
            { label: 'Current Value', value: `₹${Math.round(totalCurrent).toLocaleString()}`, color: '' },
            { label: 'Unrealized P&L', value: `${totalPnl >= 0 ? '+' : ''}₹${Math.round(totalPnl).toLocaleString()}`, color: totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400' },
            { label: bestPos ? 'Best' : '--', value: bestPos ? `${bestPos.symbol} ${bestPos.pnlPercent >= 0 ? '+' : ''}${bestPos.pnlPercent.toFixed(1)}%` : '--', color: 'text-emerald-400' },
            { label: worstPos ? 'Worst' : '--', value: worstPos ? `${worstPos.symbol} ${worstPos.pnlPercent >= 0 ? '+' : ''}${worstPos.pnlPercent.toFixed(1)}%` : '--', color: 'text-red-400' },
          ].map(item => (
            <div key={item.label} className="rounded-lg bg-secondary/50 px-3 py-2">
              <div className="text-[10px] text-muted-foreground uppercase">{item.label}</div>
              <div className={cn('text-sm font-bold font-mono mt-0.5', item.color)}>{item.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Holdings Table */}
      <Card className="border-border">
        <CardContent className="p-0">
          {positions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <TrendingUp className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">No open positions.</p>
              <p className="text-xs mt-1">Use the Scanner to find setups or add positions manually.</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[500px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background z-10">
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left px-4 py-2.5 font-medium">Symbol</th>
                    <th className="text-right px-3 py-2.5 font-medium">Qty</th>
                    <th className="text-right px-3 py-2.5 font-medium">Entry</th>
                    <th className="text-right px-3 py-2.5 font-medium">Current</th>
                    <th className="text-right px-3 py-2.5 font-medium">Today's P&L</th>
                    <th className="text-right px-3 py-2.5 font-medium">Total P&L</th>
                    <th className="text-right px-3 py-2.5 font-medium">P&L %</th>
                    <th className="text-right px-3 py-2.5 font-medium hidden md:table-cell">Value</th>
                    <th className="text-center px-3 py-2.5 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map(pos => {
                    // Real intraday move (current price vs. real previous close),
                    // not the total-since-entry unrealized P&L. previousClose==0
                    // means no real quote was available — show it honestly
                    // rather than fabricate a number.
                    const hasIntraday = pos.previousClose > 0;
                    const dirMult = pos.direction === 'LONG' ? 1 : -1;
                    const todayPnl = hasIntraday ? Math.round((pos.currentPrice - pos.previousClose) * dirMult * pos.qty) : null;
                    const todayPct = hasIntraday ? ((pos.currentPrice - pos.previousClose) * dirMult / pos.previousClose) * 100 : null;
                    return (
                    <tr key={pos.id} className="border-b border-border/30 hover:bg-secondary/30 transition">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold">{pos.symbol}</span>
                          {pos.autoTraded && <Badge variant="outline" className="text-[9px] h-4 px-1">AUTO</Badge>}
                        </div>
                        <div className="text-[10px] text-muted-foreground">{pos.direction}</div>
                      </td>
                      <td className="text-right px-3 py-2.5 font-mono">{pos.qty}</td>
                      <td className="text-right px-3 py-2.5 font-mono">₹{pos.entryPrice.toLocaleString()}</td>
                      <td className="text-right px-3 py-2.5 font-mono">
                        {pos.currentPrice > 0 ? `₹${pos.currentPrice.toLocaleString()}` : '...'}
                      </td>
                      <td className={cn('text-right px-3 py-2.5 font-mono font-medium', todayPnl === null ? 'text-muted-foreground' : todayPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {todayPnl === null ? '—' : `${todayPnl >= 0 ? '+' : ''}₹${todayPnl.toLocaleString()} (${todayPct! >= 0 ? '+' : ''}${todayPct!.toFixed(1)}%)`}
                      </td>
                      <td className={cn('text-right px-3 py-2.5 font-mono font-bold', pos.pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {pos.pnl >= 0 ? '+' : ''}₹{Math.round(pos.pnl).toLocaleString()}
                      </td>
                      <td className={cn('text-right px-3 py-2.5 font-mono', pos.pnlPercent >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {pos.pnlPercent >= 0 ? '+' : ''}{pos.pnlPercent.toFixed(2)}%
                      </td>
                      <td className="text-right px-3 py-2.5 font-mono hidden md:table-cell">
                        ₹{Math.round(pos.currentValue).toLocaleString()}
                      </td>
                      <td className="text-center px-3 py-2.5">
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setChartSymbol(pos.symbol)} className="h-7 w-7 p-0">
                            <LineChart className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => {
                            setSellTarget(pos);
                            setSellPrice(String(pos.currentPrice || pos.entryPrice));
                            setSellOpen(true);
                          }} className="h-7 w-7 p-0 text-red-400 hover:text-red-300">
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Chart popup */}
      {chartSymbol && (
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">{chartSymbol}</h3>
              <Button variant="ghost" size="sm" onClick={() => setChartSymbol(null)} className="h-7 text-xs">Close</Button>
            </div>
            <TradingViewChart symbol={chartSymbol} height={450} />
          </CardContent>
        </Card>
      )}

      {/* Sell Dialog */}
      <Dialog open={sellOpen} onOpenChange={setSellOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Sell {sellTarget?.symbol}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <Label className="text-xs">Exit Price *</Label>
              <Input type="number" value={sellPrice} onChange={e => setSellPrice(e.target.value)} className="h-8 text-xs font-mono" />
            </div>
            <div className="text-xs text-muted-foreground bg-secondary/50 rounded-lg p-3 space-y-1">
              <div className="flex justify-between"><span>Entry</span><span className="font-mono">₹{sellTarget?.entryPrice}</span></div>
              <div className="flex justify-between"><span>Qty</span><span className="font-mono">{sellTarget?.qty}</span></div>
              {sellPrice && sellTarget && (
                <div className={cn('flex justify-between font-semibold pt-1 border-t border-border/50',
                  (parseFloat(sellPrice) - sellTarget.entryPrice) * sellTarget.qty >= 0 ? 'text-emerald-400' : 'text-red-400'
                )}>
                  <span>Est. P&L</span>
                  <span className="font-mono">
                    {((parseFloat(sellPrice) - sellTarget.entryPrice) * sellTarget.qty >= 0 ? '+' : '')}
                    ₹{Math.round((parseFloat(sellPrice) - sellTarget.entryPrice) * sellTarget.qty).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost" size="sm">Cancel</Button></DialogClose>
            <Button size="sm" variant="destructive" onClick={handleSell}>Confirm Sell</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Closed Positions (collapsible) */}
      {closedTrades.length > 0 && (
        <Card className="border-border">
          <CardContent className="p-4">
            <button
              onClick={() => setShowClosed(!showClosed)}
              className="flex items-center gap-2 w-full text-left"
            >
              {showClosed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              <h3 className="text-sm font-semibold">Closed Positions ({closedTrades.length})</h3>
              <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                <span>Realized: <span className={cn('font-mono font-semibold', realized >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {realized >= 0 ? '+' : ''}₹{Math.round(realized).toLocaleString()}
                </span></span>
                <span>Win Rate: <span className="font-mono font-semibold text-indigo-400">
                  {((wins.length / closedTrades.length) * 100).toFixed(1)}%
                </span></span>
              </div>
            </button>

            {showClosed && (
              <ScrollArea className="max-h-[400px] mt-3">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-background z-10">
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left px-3 py-2 font-medium">Symbol</th>
                      <th className="text-right px-3 py-2 font-medium">Entry</th>
                      <th className="text-right px-3 py-2 font-medium">Exit</th>
                      <th className="text-right px-3 py-2 font-medium">P&L</th>
                      <th className="text-right px-3 py-2 font-medium">P&L %</th>
                      <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">Days</th>
                      <th className="text-right px-3 py-2 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closedTrades.map(t => {
                      const days = t.exitDate && t.entryDate
                        ? Math.round((new Date(t.exitDate).getTime() - new Date(t.entryDate).getTime()) / 86400000)
                        : 0;
                      return (
                        <tr key={t.id} className="border-b border-border/30 hover:bg-secondary/30">
                          <td className="px-3 py-2 font-semibold">{t.symbol}</td>
                          <td className="text-right px-3 py-2 font-mono">₹{t.entryPrice}</td>
                          <td className="text-right px-3 py-2 font-mono">₹{t.exitPrice || 0}</td>
                          <td className={cn('text-right px-3 py-2 font-mono font-semibold', (t.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                            {(t.pnl || 0) >= 0 ? '+' : ''}₹{Math.round(t.pnl || 0).toLocaleString()}
                          </td>
                          <td className={cn('text-right px-3 py-2 font-mono', (t.pnlPercent || 0) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                            {(t.pnlPercent || 0) >= 0 ? '+' : ''}{(t.pnlPercent || 0).toFixed(2)}%
                          </td>
                          <td className="text-right px-3 py-2 font-mono text-muted-foreground hidden sm:table-cell">{days}d</td>
                          <td className="text-right px-3 py-2">
                            {t.exitReason && <Badge variant="outline" className="text-[9px] h-4">{t.exitReason}</Badge>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}