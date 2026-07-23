'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { BookOpen, Plus, X, TrendingUp, TrendingDown, Minus,
  Edit, Trash2, ChevronDown, ChevronUp, Brain, Download, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ScreeningResult } from '@/lib/trading/screening-engine';
import { toast } from 'sonner';
import { TradeQualityChecklist, type ChecklistItem } from './trade-quality-checklist';
import { LivePnlTracker } from './live-pnl-tracker';

interface Trade {
  id: string;
  symbol: string;
  stockName: string | null;
  direction: string;
  entryDate: string;
  entryPrice: number;
  qty: number;
  stopLoss: number;
  targetPrice: number;
  status: string;
  exitDate: string | null;
  exitPrice: number | null;
  pnl: number | null;
  pnlPercent: number | null;
  grossPnl?: number | null;
  netPnl?: number | null;
  totalCosts?: number | null;
  brokerageCost?: number | null;
  sttCost?: number | null;
  slippageCost?: number | null;
  notes: string | null;
  tags: string | null;
  journal?: {
    id: string;
    mood: string;
    marketContext: string | null;
    emotions: string | null;
    lessonsLearned: string | null;
    rating: number | null;
  } | null;
}

interface JournalTabProps {
  prefillTrade?: ScreeningResult | null;
  onPrefillConsumed?: () => void;
}

const MOODS = [
  { value: 'CONFIDENT', label: 'Confident', color: 'text-emerald-400' },
  { value: 'NEUTRAL', label: 'Neutral', color: 'text-sky-400' },
  { value: 'ANXIOUS', label: 'Anxious', color: 'text-amber-400' },
  { value: 'FOMO', label: 'FOMO', color: 'text-red-400' },
];

export function JournalTab({ prefillTrade, onPrefillConsumed }: JournalTabProps) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(!!prefillTrade);
  const [closeTradeId, setCloseTradeId] = useState<string | null>(null);
  const [journalTradeId, setJournalTradeId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [checklistOpen, setChecklistOpen] = useState(false);

  // Form state
  const [form, setForm] = useState({
    symbol: '', stockName: '', direction: 'LONG',
    entryDate: new Date().toISOString().split('T')[0],
    entryPrice: '', qty: '', stopLoss: '', targetPrice: '',
    notes: '', tags: '',
  });

  const [closeForm, setCloseForm] = useState({ exitPrice: '', exitDate: new Date().toISOString().split('T')[0] });

  const [journalForm, setJournalForm] = useState({
    mood: 'NEUTRAL', marketContext: '', emotions: '', lessonsLearned: '', rating: '3',
  });

  // Prefill from screener
  useEffect(() => {
    if (prefillTrade) {
      setForm({
        symbol: prefillTrade.symbol,
        stockName: '',
        direction: 'LONG',
        entryDate: new Date().toISOString().split('T')[0],
        entryPrice: String(prefillTrade.entryPrice),
        qty: String(prefillTrade.sizing.qty),
        stopLoss: String(prefillTrade.stopLoss),
        targetPrice: String(prefillTrade.targetPrice),
        notes: `From screener: Score ${prefillTrade.score}/6, R:R ${prefillTrade.riskReward}x`,
        tags: 'screener,v-swing',
      });
      setAddOpen(true);
      onPrefillConsumed?.();
    }
  }, [prefillTrade, onPrefillConsumed]);

  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch('/api/trades');
      const data = await res.json();
      if (data.success) setTrades(data.trades);
    } catch (err) {
      console.error('Fetch trades error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTrades(); }, [fetchTrades]);

  // Build trade quality checklist
  const buildChecklist = (): ChecklistItem[] => {
    const items: ChecklistItem[] = [];
    const ep = parseFloat(form.entryPrice) || 0;
    const sl = parseFloat(form.stopLoss) || 0;
    const tp = parseFloat(form.targetPrice) || 0;
    const qty = parseInt(form.qty) || 0;
    const riskPerShare = ep > 0 && sl > 0 ? ep - sl : 0;
    const rr = riskPerShare > 0 && tp > 0 ? (tp - ep) / riskPerShare : 0;

    items.push({
      id: 'symbol', label: 'Symbol specified',
      description: 'Trade symbol is entered',
      passed: form.symbol.trim().length > 0, critical: true,
    });
    items.push({
      id: 'price', label: 'Valid entry price',
      description: 'Entry price must be a positive number',
      passed: ep > 0, critical: true,
    });
    items.push({
      id: 'qty', label: 'Valid quantity',
      description: 'Quantity must be a positive integer',
      passed: qty > 0, critical: true,
    });
    items.push({
      id: 'sl', label: 'Stop Loss set',
      description: 'Every trade must have a stop loss to limit downside risk',
      passed: sl > 0 && sl < ep, critical: true,
    });
    items.push({
      id: 'rr', label: `Risk:Reward >= 1.5x (current: ${rr.toFixed(1)}x)`,
      description: 'V-Swing requires minimum 1.5:1 R:R for favorable expectancy',
      passed: rr >= 1.5, critical: true,
    });
    items.push({
      id: 'tp', label: 'Target price set',
      description: 'Having a target helps manage trade expectations',
      passed: tp > ep, critical: false,
    });
    items.push({
      id: 'capital_risk', label: 'Capital risk < 2%',
      description: 'Single trade should not risk more than 2% of total capital',
      passed: riskPerShare > 0 && (riskPerShare * qty) < 4000, critical: false,
    });
    items.push({
      id: 'notes', label: 'Trade notes added',
      description: 'Documenting the reason for the trade improves future review',
      passed: form.notes.trim().length > 10, critical: false,
    });
    return items;
  };

  const openChecklist = () => {
    setChecklistOpen(true);
  };

  const createTrade = async () => {
    setChecklistOpen(false);
    try {
      await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          entryPrice: parseFloat(form.entryPrice),
          qty: parseInt(form.qty),
          stopLoss: parseFloat(form.stopLoss),
          targetPrice: parseFloat(form.targetPrice),
        }),
      });
      setAddOpen(false);
      setForm({ symbol: '', stockName: '', direction: 'LONG', entryDate: new Date().toISOString().split('T')[0], entryPrice: '', qty: '', stopLoss: '', targetPrice: '', notes: '', tags: '' });
      fetchTrades();
      toast.success(`Paper trade logged: ${form.symbol} × ${form.qty}`, {
        description: `Entry: ₹${form.entryPrice} | SL: ₹${form.stopLoss} | Target: ₹${form.targetPrice}`,
      });
    } catch (err) {
      toast.error('Failed to create trade');
      console.error('Create trade error:', err);
    }
  };

  const closeTrade = async (id: string) => {
    try {
      await fetch('/api/trades', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          exitPrice: parseFloat(closeForm.exitPrice),
          exitDate: closeForm.exitDate,
          status: 'CLOSED',
        }),
      });
      setCloseTradeId(null);
      fetchTrades();
      const t = trades.find(t => t.id === id);
      toast.success(`Trade closed: ${t?.symbol}`, { description: `Exit: ₹${closeForm.exitPrice}` });
    } catch (err) {
      toast.error('Failed to close trade');
      console.error('Close trade error:', err);
    }
  };

  const deleteTrade = async (id: string) => {
    try {
      const t = trades.find(t => t.id === id);
      await fetch(`/api/trades?id=${id}`, { method: 'DELETE' });
      fetchTrades();
      toast.info(`Deleted trade: ${t?.symbol}`);
    } catch (err) {
      toast.error('Failed to delete trade');
      console.error('Delete error:', err);
    }
  };

  const saveJournal = async (tradeId: string) => {
    try {
      await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradeId,
          mood: journalForm.mood,
          marketContext: journalForm.marketContext || null,
          emotions: journalForm.emotions || null,
          lessonsLearned: journalForm.lessonsLearned || null,
          rating: parseInt(journalForm.rating) || null,
        }),
      });
      setJournalTradeId(null);
      fetchTrades();
      toast.success(`Journal saved for trade`);
    } catch (err) {
      toast.error('Failed to save journal');
      console.error('Journal error:', err);
    }
  };

  const openTrades = trades.filter(t => t.status === 'OPEN');
  const closedTrades = trades.filter(t => t.status === 'CLOSED');
  const totalPnL = closedTrades.reduce((s, t) => s + (t.pnl || 0), 0);
  const wins = closedTrades.filter(t => (t.pnl || 0) > 0).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            Automated PMS Execution Journal & Audit Log
          </h2>
          <Badge className="bg-indigo-500/20 text-indigo-400 border-indigo-500/30 gap-1 font-mono text-[10px]">
            <Shield className="h-3 w-3" /> 100% Autonomous Engine Executions
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => {
            window.open('/api/export', '_blank');
            toast.info('Exporting trades to CSV...');
          }}>
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Export CSV</span>
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card><CardContent className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Open Trades</div>
          <div className="text-2xl font-bold mt-1">{openTrades.length}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Closed Trades</div>
          <div className="text-2xl font-bold mt-1">{closedTrades.length}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Win Rate</div>
          <div className="text-2xl font-bold mt-1">{closedTrades.length > 0 ? Math.round((wins / closedTrades.length) * 100) : 0}%</div>
        </CardContent></Card>
        <Card className={totalPnL >= 0 ? 'border-emerald-500/20' : 'border-red-500/20'}><CardContent className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total P&L</div>
          <div className={cn('text-2xl font-bold mt-1', totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {totalPnL >= 0 ? '+' : ''}₹{Math.round(totalPnL).toLocaleString()}
          </div>
        </CardContent></Card>
      </div>

      {/* Live P&L Tracker for open positions */}
      <LivePnlTracker />

      {/* Trade List */}
      <ScrollArea className="max-h-[calc(100vh-340px)]">
        <div className="space-y-3 pr-4">
          {trades.length === 0 && !loading && (
            <div className="text-center py-16 text-muted-foreground">
              <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No trades yet. Start by adding a paper trade or scanning for setups.</p>
            </div>
          )}

          {trades.map(trade => (
            <Card key={trade.id} className={cn(
              'border transition-all',
              trade.status === 'OPEN' ? 'border-primary/20' : '',
              (trade.pnl || 0) > 0 ? 'border-emerald-500/10' : (trade.pnl || 0) < 0 ? 'border-red-500/10' : '',
            )}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'h-9 w-9 rounded-lg flex items-center justify-center text-xs font-bold',
                      trade.status === 'OPEN' ? 'bg-primary/15 text-primary' :
                      (trade.pnl || 0) > 0 ? 'bg-emerald-500/15 text-emerald-400' :
                      'bg-red-500/15 text-red-400'
                    )}>
                      {trade.status === 'OPEN' ? (
                        trade.direction === 'LONG' ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />
                      ) : (trade.pnl || 0) > 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{trade.symbol}</span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{trade.status}</Badge>
                        {trade.direction === 'LONG' && <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-emerald-400 border-emerald-500/30">LONG</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {new Date(trade.entryDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        {' @ '}₹{trade.entryPrice} × {trade.qty}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {trade.status === 'OPEN' && (
                      <Dialog open={closeTradeId === trade.id} onOpenChange={open => { if (!open) setCloseTradeId(null); else setCloseTradeId(trade.id); }}>
                        <DialogTrigger asChild>
                          <Button size="sm" variant="outline" className="h-7 text-xs">Close Trade</Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-sm">
                          <DialogHeader><DialogTitle>Close Trade: {trade.symbol}</DialogTitle></DialogHeader>
                          <div className="grid gap-3 py-2">
                            <div className="space-y-2">
                              <Label className="text-xs">Exit Price</Label>
                              <Input type="number" value={closeForm.exitPrice} onChange={e => setCloseForm(f => ({ ...f, exitPrice: e.target.value }))} placeholder="0.00" className="h-9 text-sm" />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs">Exit Date</Label>
                              <Input type="date" value={closeForm.exitDate} onChange={e => setCloseForm(f => ({ ...f, exitDate: e.target.value }))} className="h-9 text-sm" />
                            </div>
                          </div>
                          <DialogFooter>
                            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                            <Button onClick={() => closeTrade(trade.id)} disabled={!closeForm.exitPrice}>Close</Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    )}
                    <Dialog open={journalTradeId === trade.id} onOpenChange={open => { if (!open) setJournalTradeId(null); else { setJournalTradeId(trade.id); setJournalForm({ mood: trade.journal?.mood || 'NEUTRAL', marketContext: trade.journal?.marketContext || '', emotions: trade.journal?.emotions || '', lessonsLearned: trade.journal?.lessonsLearned || '', rating: String(trade.journal?.rating || '3') }); }}}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0"><Brain className="h-3.5 w-3.5" /></Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-md">
                        <DialogHeader><DialogTitle>Trade Journal: {trade.symbol}</DialogTitle></DialogHeader>
                        <div className="grid gap-4 py-2">
                          <div className="space-y-2">
                            <Label className="text-xs">Mood at Entry</Label>
                            <div className="flex gap-2">
                              {MOODS.map(m => (
                                <Button key={m.value} size="sm" variant={journalForm.mood === m.value ? 'default' : 'outline'} onClick={() => setJournalForm(f => ({ ...f, mood: m.value }))} className={cn('text-xs', journalForm.mood === m.value && 'bg-secondary text-foreground')}>
                                  {m.label}
                                </Button>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs">Market Context</Label>
                            <Input value={journalForm.marketContext} onChange={e => setJournalForm(f => ({ ...f, marketContext: e.target.value }))} placeholder="Nifty trending, sector rotation..." className="h-9 text-sm" />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs">Emotions / Psychology</Label>
                            <Textarea value={journalForm.emotions} onChange={e => setJournalForm(f => ({ ...f, emotions: e.target.value }))} placeholder="Felt anxious about size, confident in setup..." className="text-sm min-h-[50px]" />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs">Lessons Learned</Label>
                            <Textarea value={journalForm.lessonsLearned} onChange={e => setJournalForm(f => ({ ...f, lessonsLearned: e.target.value }))} placeholder="What would you do differently?" className="text-sm min-h-[50px]" />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs">Self-Rating: {journalForm.rating}/5</Label>
                            <input type="range" min="1" max="5" value={journalForm.rating} onChange={e => setJournalForm(f => ({ ...f, rating: e.target.value }))} className="w-full" />
                          </div>
                        </div>
                        <DialogFooter>
                          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                          <Button onClick={() => saveJournal(trade.id)}>Save Journal</Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400" onClick={() => deleteTrade(trade.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpandedId(expandedId === trade.id ? null : trade.id)}>
                      {expandedId === trade.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                {/* P&L Bar for closed trades */}
                {trade.status === 'CLOSED' && trade.pnl != null && (
                  <div className="mt-3 flex items-center gap-3">
                    <div className={cn('text-sm font-mono font-bold', trade.pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {trade.pnl >= 0 ? '+' : ''}₹{Math.round(trade.pnl).toLocaleString()}
                    </div>
                    <Badge variant="outline" className={cn('text-[10px] font-mono', trade.pnl >= 0 ? 'text-emerald-400 border-emerald-500/30' : 'text-red-400 border-red-500/30')}>
                      {trade.pnl >= 0 ? '+' : ''}{trade.pnlPercent?.toFixed(2)}%
                    </Badge>
                    {trade.journal && (
                      <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-500/30">
                        Journal: {trade.journal.mood}
                      </Badge>
                    )}
                  </div>
                )}

                {/* Expanded details */}
                {expandedId === trade.id && (
                  <div className="mt-3 border-t border-border pt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="rounded bg-secondary/50 px-3 py-2">
                      <div className="text-muted-foreground">SL</div>
                      <div className="font-mono font-semibold text-red-400">₹{trade.stopLoss}</div>
                    </div>
                    <div className="rounded bg-secondary/50 px-3 py-2">
                      <div className="text-muted-foreground">Target</div>
                      <div className="font-mono font-semibold text-emerald-400">₹{trade.targetPrice}</div>
                    </div>
                    {trade.status === 'CLOSED' && (
                      <>
                        <div className="rounded bg-secondary/50 px-3 py-2">
                          <div className="text-muted-foreground">Exit Price</div>
                          <div className="font-mono font-semibold">₹{trade.exitPrice}</div>
                        </div>
                        <div className="rounded bg-secondary/50 px-3 py-2">
                          <div className="text-muted-foreground">Holding Days</div>
                          <div className="font-mono font-semibold">
                            {Math.round((new Date(trade.exitDate || '').getTime() - new Date(trade.entryDate).getTime()) / (1000 * 60 * 60 * 24))}d
                          </div>
                        </div>
                        {trade.grossPnl != null && (
                          <div className="rounded bg-secondary/50 px-3 py-2">
                            <div className="text-muted-foreground">Gross P&L</div>
                            <div className={cn("font-mono font-semibold", trade.grossPnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                              {trade.grossPnl >= 0 ? '+' : ''}₹{Math.round(trade.grossPnl).toLocaleString()}
                            </div>
                          </div>
                        )}
                        {trade.totalCosts != null && (
                          <div className="rounded bg-secondary/50 px-3 py-2">
                            <div className="text-muted-foreground">Total Costs</div>
                            <div className="font-mono font-semibold text-amber-400">
                              −₹{Math.round(trade.totalCosts).toLocaleString()}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    {trade.status === 'OPEN' && (
                      <>
                        <div className="rounded bg-secondary/50 px-3 py-2">
                          <div className="text-muted-foreground">Capital at Risk</div>
                          <div className="font-mono font-semibold">₹{Math.round(Math.abs(trade.entryPrice - trade.stopLoss) * trade.qty).toLocaleString()}</div>
                        </div>
                        <div className="rounded bg-secondary/50 px-3 py-2">
                          <div className="text-muted-foreground">R:R</div>
                          <div className="font-mono font-semibold">{(Math.abs(trade.targetPrice - trade.entryPrice) / Math.abs(trade.entryPrice - trade.stopLoss)).toFixed(1)}x</div>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Notes */}
                {trade.notes && expandedId !== trade.id && (
                  <p className="mt-2 text-xs text-muted-foreground truncate">{trade.notes}</p>
                )}
                {trade.notes && expandedId === trade.id && (
                  <p className="mt-2 text-xs text-muted-foreground">{trade.notes}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>

      {/* Trade Quality Checklist Dialog */}
      <TradeQualityChecklist
        open={checklistOpen}
        onClose={() => setChecklistOpen(false)}
        onConfirm={createTrade}
        checklistItems={buildChecklist()}
        symbol={form.symbol || 'TRADE'}
      />
    </div>
  );
}