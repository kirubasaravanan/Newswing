'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  BarChart3, TrendingUp, TrendingDown, Target, Shield, AlertTriangle,
  RefreshCw, Plus, X, ArrowRight, Clock, Zap, Info, ChevronDown,
} from 'lucide-react';
import {
  BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { cn } from '@/lib/utils';

// ── Constants ────────────────────────────────────────────────

const SYMBOLS = [
  'NIFTY', 'BANKNIFTY', 'FINNIFTY', 'RELIANCE', 'TCS', 'INFY',
  'HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK', 'KOTAKBANK',
  'BAJFINANCE', 'ITC', 'HINDUNILVR', 'LT', 'BHARTIARTL',
  'MARUTI', 'TATAMOTORS', 'SUNPHARMA', 'WIPRO',
];

const STRATEGY_TEMPLATES = [
  {
    id: 'straddle',
    name: 'Long Straddle',
    description: 'Buy ATM CE + ATM PE. Profits from big moves in either direction.',
    condition: 'High IV, expecting large move',
    legs: [
      { optionType: 'CE', action: 'BUY', strikeOffset: 0 },
      { optionType: 'PE', action: 'BUY', strikeOffset: 0 },
    ],
  },
  {
    id: 'strangle',
    name: 'Long Strangle',
    description: 'Buy OTM CE + OTM PE. Cheaper than straddle, needs bigger move.',
    condition: 'High IV, expecting very large move',
    legs: [
      { optionType: 'CE', action: 'BUY', strikeOffset: 5 },
      { optionType: 'PE', action: 'BUY', strikeOffset: -5 },
    ],
  },
  {
    id: 'iron-condor',
    name: 'Iron Condor',
    description: 'Sell OTM strangle + buy further OTM wings. Profits from range-bound markets.',
    condition: 'Low IV, expecting range-bound',
    legs: [
      { optionType: 'PE', action: 'BUY', strikeOffset: -15 },
      { optionType: 'PE', action: 'SELL', strikeOffset: -10 },
      { optionType: 'CE', action: 'SELL', strikeOffset: 10 },
      { optionType: 'CE', action: 'BUY', strikeOffset: 15 },
    ],
  },
  {
    id: 'covered-call',
    name: 'Covered Call',
    description: 'Hold stock + sell OTM CE. Generates income from premium.',
    condition: 'Bullish but capped upside',
    legs: [
      { optionType: 'CE', action: 'SELL', strikeOffset: 10 },
    ],
  },
  {
    id: 'calendar',
    name: 'Calendar Spread',
    description: 'Sell near-term + buy far-term same strike. Profits from time decay differential.',
    condition: 'Neutral, expecting low volatility',
    legs: [
      { optionType: 'CE', action: 'SELL', strikeOffset: 0 },
      { optionType: 'CE', action: 'BUY', strikeOffset: 0 },
    ],
  },
];

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#8b5cf6', '#14b8a6'];

// ── Types ────────────────────────────────────────────────────

interface ChainRow {
  strike: number;
  ce: { ltp: number; iv: number; delta: number; gamma: number; theta: number; vega: number; oi: number; volume: number; bid: number; ask: number; itm: boolean };
  pe: { ltp: number; iv: number; delta: number; gamma: number; theta: number; vega: number; oi: number; volume: number; bid: number; ask: number; itm: boolean };
  distance: number;
  moneyness: 'ITM' | 'ATM' | 'OTM';
}

interface ChainData {
  symbol: string;
  underlyingPrice: number;
  change: number;
  changePct: number;
  expiryDate: string;
  expiryDates: string[];
  chain: ChainRow[];
}

interface Position {
  id: string;
  symbol: string;
  optionType: string;
  action: string;
  strikePrice: number;
  entryPremium: number;
  currentPremium: number;
  lotSize: number;
  qty: number;
  expiryDate: string;
  stopLoss: number | null;
  takeProfit: number | null;
  entryDelta: number | null;
  entryGamma: number | null;
  entryTheta: number | null;
  entryVega: number | null;
  entryIV: number | null;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  notes: string | null;
}

interface Strategy {
  id: string;
  name: string;
  symbol: string;
  underlyingPrice: number;
  status: string;
  totalMargin: number;
  totalPnl: number;
  legs: string;
  expiryDate: string;
  createdAt: string;
  trades: any[];
}

// ── Helpers ──────────────────────────────────────────────────

const safeJson = async (res: Response | null) => {
  if (!res) return null;
  try { return await res.json(); } catch { return null; }
};

const fetchSafe = async (url: string) => {
  const res = await fetch(url).catch(() => null);
  return res ? await safeJson(res) : null;
};

const fmt = (n: number | null | undefined, decimals = 2) => {
  if (n == null) return '—';
  return n.toFixed(decimals);
};

const fmtRupee = (n: number | null | undefined) => {
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  if (abs >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
};

// ── Component ────────────────────────────────────────────────

export function OptionsTab() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10">
          <BarChart3 className="h-5 w-5 text-indigo-400" />
        </div>
        <div>
          <h1 className="text-lg font-bold">Options Trading</h1>
          <p className="text-xs text-muted-foreground">Black-Scholes priced chain with Greeks-based risk management</p>
        </div>
      </div>

      <Tabs defaultValue="chain" className="space-y-4">
        <TabsList className="bg-secondary/50 h-9 p-0.5">
          <TabsTrigger value="chain" className="text-xs px-3 h-8 data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
            Option Chain
          </TabsTrigger>
          <TabsTrigger value="trade" className="text-xs px-3 h-8 data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
            New Trade
          </TabsTrigger>
          <TabsTrigger value="positions" className="text-xs px-3 h-8 data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
            Positions
          </TabsTrigger>
          <TabsTrigger value="strategies" className="text-xs px-3 h-8 data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
            Strategies
          </TabsTrigger>
          <TabsTrigger value="analytics" className="text-xs px-3 h-8 data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
            Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chain"><OptionChainTab /></TabsContent>
        <TabsContent value="trade"><NewTradeTab /></TabsContent>
        <TabsContent value="positions"><PositionsTab /></TabsContent>
        <TabsContent value="strategies"><StrategiesTab /></TabsContent>
        <TabsContent value="analytics"><AnalyticsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// SUB-TAB 1: Option Chain
// ══════════════════════════════════════════════════════════════

function OptionChainTab() {
  const [symbol, setSymbol] = useState('NIFTY');
  const [chainData, setChainData] = useState<ChainData | null>(null);
  const [loading, setLoading] = useState(false);
  const [prefill, setPrefill] = useState<{ strike: number; type: 'CE' | 'PE'; premium: number } | null>(null);

  const fetchChain = useCallback(async () => {
    setLoading(true);
    const expiry = chainData?.expiryDate || '';
    const url = `/api/options/chain?symbol=${symbol}${expiry ? `&expiry=${expiry}` : ''}`;
    const data = await fetchSafe(url);
    if (data?.success) {
      setChainData(data);
    }
    setLoading(false);
  }, [symbol, chainData?.expiryDate]);

  useEffect(() => { fetchChain(); }, [symbol]);

  const handleRowClick = (strike: number, type: 'CE' | 'PE', premium: number) => {
    setPrefill({ strike, type, premium });
  };

  const handlePrefillTrade = () => {
    if (prefill) {
      // Store in sessionStorage for the trade tab to pick up
      sessionStorage.setItem('options-prefill', JSON.stringify(prefill));
    }
  };

  const expiryCountdown = useMemo(() => {
    if (!chainData?.expiryDate) return '—';
    const now = new Date();
    const expiry = new Date(chainData.expiryDate + 'T15:30:00+05:30');
    const days = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return days <= 0 ? 'Expiry Day' : `${days}d ${Math.max(0, 23 - now.getHours())}h`;
  }, [chainData?.expiryDate]);

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={symbol} onValueChange={(v) => { setSymbol(v); setChainData(null); }}>
          <SelectTrigger className="w-40 h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SYMBOLS.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {chainData?.expiryDates && (
          <Select
            value={chainData.expiryDate}
            onValueChange={(v) => setChainData({ ...chainData, expiryDate: v, chain: [] })}
          >
            <SelectTrigger className="w-44 h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {chainData.expiryDates.map((e) => (
                <SelectItem key={e} value={e}>{e}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button variant="outline" size="sm" onClick={fetchChain} disabled={loading} className="h-9">
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Spot Info */}
      {chainData && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg bg-secondary/30 px-4 py-2.5 text-sm">
          <div>
            <span className="text-muted-foreground">{chainData.symbol}</span>{' '}
            <span className="font-bold text-lg">{fmt(chainData.underlyingPrice)}</span>
          </div>
          <div className={cn(
            'flex items-center gap-1 text-sm font-medium',
            chainData.change >= 0 ? 'text-emerald-400' : 'text-red-400'
          )}>
            {chainData.change >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            {fmt(chainData.change)} ({fmt(chainData.changePct)}%)
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <Clock className="h-3 w-3" />
            Expiry: {chainData.expiryDate} ({expiryCountdown})
          </div>
          {prefill && (
            <Button size="sm" onClick={handlePrefillTrade} className="ml-auto h-7 text-xs bg-indigo-600 hover:bg-indigo-700">
              <ArrowRight className="h-3 w-3 mr-1" /> Trade {prefill.strike} {prefill.type}
            </Button>
          )}
        </div>
      )}

      {/* Chain Table */}
      <Card className="overflow-hidden">
        <ScrollArea className="h-[520px]">
          {chainData?.chain.length ? (
            <Table className="text-xs">
              <TableHeader>
                <TableRow className="bg-secondary/20 hover:bg-secondary/20">
                  <TableHead className="text-center h-8 w-16">OI(CE)</TableHead>
                  <TableHead className="text-center h-8 w-16">Vol(CE)</TableHead>
                  <TableHead className="text-center h-8 w-12">IV%</TableHead>
                  <TableHead className="text-center h-8 w-14">LTP(CE)</TableHead>
                  <TableHead className="text-center h-8 w-10">Δ</TableHead>
                  <TableHead className="text-center h-8 w-10">Γ</TableHead>
                  <TableHead className="text-center h-8 w-10">Θ</TableHead>
                  <TableHead className="text-center h-8 font-bold w-20">Strike</TableHead>
                  <TableHead className="text-center h-8 w-10">Θ</TableHead>
                  <TableHead className="text-center h-8 w-10">Γ</TableHead>
                  <TableHead className="text-center h-8 w-10">Δ</TableHead>
                  <TableHead className="text-center h-8 w-14">LTP(PE)</TableHead>
                  <TableHead className="text-center h-8 w-12">IV%</TableHead>
                  <TableHead className="text-center h-8 w-16">Vol(PE)</TableHead>
                  <TableHead className="text-center h-8 w-16">OI(PE)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {chainData.chain.map((row) => {
                  const isATM = row.moneyness === 'ATM';
                  const ceITM = row.ce.itm;
                  const peITM = row.pe.itm;
                  return (
                    <TableRow
                      key={row.strike}
                      className={cn(
                        'h-7 cursor-pointer',
                        isATM && 'bg-indigo-500/10 ring-1 ring-indigo-500/30',
                        !isATM && ceITM && 'bg-red-500/5',
                        !isATM && peITM && 'bg-emerald-500/5',
                      )}
                      onClick={() => handleRowClick(row.strike, 'CE', row.ce.ltp)}
                    >
                      <TableCell className="text-center text-muted-foreground">{(row.ce.oi / 1000).toFixed(0)}K</TableCell>
                      <TableCell className="text-center">{(row.ce.volume / 1000).toFixed(0)}K</TableCell>
                      <TableCell className="text-center text-amber-400">{row.ce.iv.toFixed(1)}</TableCell>
                      <TableCell
                        className="text-center font-medium text-emerald-400 cursor-pointer hover:bg-emerald-500/10"
                        onClick={(e) => { e.stopPropagation(); handleRowClick(row.strike, 'CE', row.ce.ltp); }}
                      >
                        {row.ce.ltp}
                      </TableCell>
                      <TableCell className="text-center">{row.ce.delta.toFixed(2)}</TableCell>
                      <TableCell className="text-center">{row.ce.gamma.toFixed(4)}</TableCell>
                      <TableCell className={cn('text-center', row.ce.theta < 0 ? 'text-red-400' : 'text-emerald-400')}>
                        {row.ce.theta.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-center font-bold bg-secondary/10 text-foreground">
                        {row.strike}
                      </TableCell>
                      <TableCell className={cn('text-center', row.pe.theta < 0 ? 'text-red-400' : 'text-emerald-400')}>
                        {row.pe.theta.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-center">{row.pe.gamma.toFixed(4)}</TableCell>
                      <TableCell className="text-center">{row.pe.delta.toFixed(2)}</TableCell>
                      <TableCell
                        className="text-center font-medium text-red-400 cursor-pointer hover:bg-red-500/10"
                        onClick={(e) => { e.stopPropagation(); handleRowClick(row.strike, 'PE', row.pe.ltp); }}
                      >
                        {row.pe.ltp}
                      </TableCell>
                      <TableCell className="text-center text-amber-400">{row.pe.iv.toFixed(1)}</TableCell>
                      <TableCell className="text-center">{(row.pe.volume / 1000).toFixed(0)}K</TableCell>
                      <TableCell className="text-center text-muted-foreground">{(row.pe.oi / 1000).toFixed(0)}K</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
              {loading ? 'Loading option chain...' : 'Select a symbol and expiry to view chain'}
            </div>
          )}
        </ScrollArea>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// SUB-TAB 2: New Trade
// ══════════════════════════════════════════════════════════════

function NewTradeTab() {
  const [symbol, setSymbol] = useState('NIFTY');
  const [expiry, setExpiry] = useState('');
  const [expiryDates, setExpiryDates] = useState<string[]>([]);
  const [optionType, setOptionType] = useState<'CE' | 'PE'>('CE');
  const [action, setAction] = useState<'BUY' | 'SELL'>('BUY');
  const [strikePrice, setStrikePrice] = useState('');
  const [lotSize, setLotSize] = useState(25);
  const [qty, setQty] = useState(1);
  const [entryPremium, setEntryPremium] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [autoSLTP, setAutoSLTP] = useState(true);
  const [notes, setNotes] = useState('');
  const [spotPrice, setSpotPrice] = useState(0);
  const [greeks, setGreeks] = useState<any>(null);
  const [sltp, setSltp] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');

  // Load expiries when symbol changes
  useEffect(() => {
    const loadExpiries = async () => {
      const data = await fetchSafe(`/api/options/chain?symbol=${symbol}`);
      if (data?.success) {
        setExpiryDates(data.expiryDates || []);
        setExpiry(data.expiryDate || '');
        setSpotPrice(data.underlyingPrice || 0);
      }
    };
    loadExpiries();
  }, [symbol]);

  // Pre-fill from chain click
  useEffect(() => {
    const prefilled = sessionStorage.getItem('options-prefill');
    if (prefilled) {
      try {
        const p = JSON.parse(prefilled);
        setStrikePrice(String(p.strike));
        setOptionType(p.type);
        setEntryPremium(String(p.premium));
        sessionStorage.removeItem('options-prefill');
      } catch { /* ignore */ }
    }
  }, []);

  // Update lot size when symbol changes
  useEffect(() => {
    const lsMap: Record<string, number> = {
      NIFTY: 25, BANKNIFTY: 15, FINNIFTY: 25, RELIANCE: 250, TCS: 175,
      INFY: 300, HDFCBANK: 550, ICICIBANK: 700, SBIN: 1500, AXISBANK: 900,
      KOTAKBANK: 800, BAJFINANCE: 250, ITC: 3200, HINDUNILVR: 300, LT: 150,
      BHARTIARTL: 475, MARUTI: 100, TATAMOTORS: 550, SUNPHARMA: 1250, WIPRO: 1500,
    };
    setLotSize(lsMap[symbol] || 100);
  }, [symbol]);

  // Fetch Greeks when inputs change
  const fetchGreeks = useCallback(async () => {
    if (!strikePrice || !expiry || !spotPrice || !entryPremium) {
      setGreeks(null);
      setSltp(null);
      return;
    }

    const url = `/api/options/greeks?symbol=${symbol}&strike=${strikePrice}&expiry=${expiry}&type=${optionType}&spot=${spotPrice}&premium=${entryPremium}&action=${action}`;
    const data = await fetchSafe(url);
    if (data?.success) {
      setGreeks(data.greeks);
      if (autoSLTP) {
        setSltp(data.sltp);
        setStopLoss(String(data.sltp.stopLoss));
        setTakeProfit(String(data.sltp.takeProfit));
      }
    }
  }, [symbol, strikePrice, expiry, optionType, spotPrice, entryPremium, action, autoSLTP]);

  useEffect(() => { fetchGreeks(); }, [fetchGreeks]);

  const totalPremium = parseFloat(entryPremium || '0') * lotSize * qty;
  const totalShares = lotSize * qty;

  const handleSubmit = async () => {
    if (!strikePrice || !entryPremium || !expiry) return;
    setSubmitting(true);
    setSuccess('');

    const body: any = {
      symbol, optionType, action,
      strikePrice: parseFloat(strikePrice),
      expiryDate: expiry,
      lotSize, qty,
      entryPremium: parseFloat(entryPremium),
      underlyingPrice: spotPrice,
      notes: notes || undefined,
    };

    if (!autoSLTP) {
      if (stopLoss) body.stopLoss = parseFloat(stopLoss);
      if (takeProfit) body.takeProfit = parseFloat(takeProfit);
    }

    const res = await fetch('/api/options/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);

    const data = res ? await safeJson(res) : null;
    if (data?.success) {
      setSuccess(`Trade created: ${symbol} ${strikePrice} ${optionType} ${action}`);
      setStrikePrice('');
      setEntryPremium('');
      setStopLoss('');
      setTakeProfit('');
      setNotes('');
      setGreeks(null);
      setSltp(null);
    }
    setSubmitting(false);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Trade Form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">New Option Trade</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Symbol</Label>
              <Select value={symbol} onValueChange={setSymbol}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SYMBOLS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Expiry</Label>
              <Select value={expiry} onValueChange={setExpiry}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {expiryDates.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Option Type & Action */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Option Type</Label>
              <div className="flex rounded-lg overflow-hidden border">
                <button
                  className={cn('flex-1 py-2 text-sm font-medium transition-colors', optionType === 'CE' ? 'bg-emerald-600 text-white' : 'bg-secondary text-muted-foreground hover:bg-secondary/80')}
                  onClick={() => setOptionType('CE')}
                >CE (Call)</button>
                <button
                  className={cn('flex-1 py-2 text-sm font-medium transition-colors', optionType === 'PE' ? 'bg-red-600 text-white' : 'bg-secondary text-muted-foreground hover:bg-secondary/80')}
                  onClick={() => setOptionType('PE')}
                >PE (Put)</button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Action</Label>
              <div className="flex rounded-lg overflow-hidden border">
                <button
                  className={cn('flex-1 py-2 text-sm font-medium transition-colors', action === 'BUY' ? 'bg-emerald-600 text-white' : 'bg-secondary text-muted-foreground hover:bg-secondary/80')}
                  onClick={() => setAction('BUY')}
                >BUY</button>
                <button
                  className={cn('flex-1 py-2 text-sm font-medium transition-colors', action === 'SELL' ? 'bg-red-600 text-white' : 'bg-secondary text-muted-foreground hover:bg-secondary/80')}
                  onClick={() => setAction('SELL')}
                >SELL</button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Strike Price</Label>
              <Input type="number" value={strikePrice} onChange={(e) => setStrikePrice(e.target.value)} className="h-9 text-sm" placeholder="24000" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Lot Size</Label>
              <Input type="number" value={lotSize} onChange={(e) => setLotSize(parseInt(e.target.value) || 1)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Qty (Lots)</Label>
              <Input type="number" value={qty} onChange={(e) => setQty(parseInt(e.target.value) || 1)} className="h-9 text-sm" min={1} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Entry Premium (per share)</Label>
            <Input type="number" value={entryPremium} onChange={(e) => setEntryPremium(e.target.value)} className="h-9 text-sm" placeholder="250" step="0.5" />
            {totalPremium > 0 && (
              <p className="text-xs text-muted-foreground">Total Premium: <span className="text-foreground font-medium">₹{totalPremium.toLocaleString()}</span> ({lotSize} × {qty} shares)</p>
            )}
          </div>

          <Separator />

          {/* SL/TP Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox id="auto-sltp" checked={autoSLTP} onCheckedChange={(v) => setAutoSLTP(v === true)} />
              <Label htmlFor="auto-sltp" className="text-xs font-medium">Auto-calculate SL/TP from Greeks</Label>
            </div>

            <div className={cn('grid grid-cols-2 gap-3', autoSLTP && 'opacity-60 pointer-events-none')}>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">SL per share (₹)</Label>
                <Input type="number" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} className="h-9 text-sm" step="0.5" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">TP per share (₹)</Label>
                <Input type="number" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} className="h-9 text-sm" step="0.5" />
              </div>
            </div>

            {sltp?.slReasoning && (
              <p className="text-[10px] text-muted-foreground bg-secondary/30 rounded p-2">
                <Shield className="h-3 w-3 inline mr-1 text-amber-400" />
                {sltp.slReasoning}
              </p>
            )}
            {sltp?.tpReasoning && (
              <p className="text-[10px] text-muted-foreground bg-secondary/30 rounded p-2">
                <Target className="h-3 w-3 inline mr-1 text-emerald-400" />
                {sltp.tpReasoning}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="text-sm min-h-[60px]" placeholder="Optional trade notes..." />
          </div>

          {success && (
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-xs text-emerald-400">
              {success}
            </div>
          )}

          <Button onClick={handleSubmit} disabled={submitting || !strikePrice || !entryPremium} className="w-full bg-indigo-600 hover:bg-indigo-700 h-9">
            {submitting ? 'Creating...' : 'Create Option Trade'}
          </Button>
        </CardContent>
      </Card>

      {/* Greeks & Risk Display */}
      <div className="space-y-4">
        {/* Greeks Grid */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Greeks at Entry</CardTitle>
          </CardHeader>
          <CardContent>
            {greeks ? (
              <div className="grid grid-cols-5 gap-2">
                {[
                  { label: 'Delta (Δ)', value: greeks.delta, color: '' },
                  { label: 'Gamma (Γ)', value: greeks.gamma, color: '' },
                  { label: 'Theta (Θ)', value: greeks.theta, color: greeks.theta < 0 ? 'text-red-400' : 'text-emerald-400' },
                  { label: 'Vega (ν)', value: greeks.vega, color: '' },
                  { label: 'IV %', value: `${greeks.iv}%`, color: 'text-amber-400' },
                ].map((g) => (
                  <div key={g.label} className="rounded-lg bg-secondary/30 p-2.5 text-center">
                    <div className="text-[10px] text-muted-foreground mb-1">{g.label}</div>
                    <div className={cn('text-sm font-bold', g.color)}>{g.value}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">Enter premium to see Greeks</p>
            )}
          </CardContent>
        </Card>

        {/* Risk Metrics */}
        {sltp && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Risk Analysis</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-red-500/5 border border-red-500/10 p-3">
                  <div className="text-[10px] text-muted-foreground">Max Loss</div>
                  <div className="text-lg font-bold text-red-400">₹{fmt(sltp.maxLoss, 0)}</div>
                </div>
                <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/10 p-3">
                  <div className="text-[10px] text-muted-foreground">Max Profit</div>
                  <div className="text-lg font-bold text-emerald-400">₹{fmt(sltp.maxProfit, 0)}</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded bg-secondary/30 p-2">
                  <div className="text-[10px] text-muted-foreground">Risk:Reward</div>
                  <div className="text-sm font-bold">{fmt(sltp.riskReward)}:1</div>
                </div>
                <div className="rounded bg-secondary/30 p-2">
                  <div className="text-[10px] text-muted-foreground">Breakeven</div>
                  <div className="text-sm font-bold">{sltp.breakeven}</div>
                </div>
                <div className="rounded bg-secondary/30 p-2">
                  <div className="text-[10px] text-muted-foreground">Margin Est.</div>
                  <div className="text-sm font-bold">₹{fmt(sltp.marginEstimate, 0)}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded bg-secondary/30 p-2">
                  <div className="text-[10px] text-muted-foreground">Theta Decay/Day</div>
                  <div className="text-sm font-bold text-red-400">₹{sltp.thetaDecayPerDay} × {totalShares}</div>
                </div>
                <div className="rounded bg-secondary/30 p-2">
                  <div className="text-[10px] text-muted-foreground">Days to Expiry</div>
                  <div className="text-sm font-bold">{sltp.daysToExpiry}</div>
                </div>
              </div>

              {/* Visual Risk Meter */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>SL ({sltp.stopLoss})</span>
                  <span>Risk:Reward {fmt(sltp.riskReward)}:1</span>
                  <span>TP ({sltp.takeProfit})</span>
                </div>
                <div className="h-3 rounded-full bg-secondary/50 overflow-hidden flex">
                  {(() => {
                    const entryP = parseFloat(entryPremium || '0');
                    const slDist = Math.abs(entryP - sltp.stopLoss);
                    const tpDist = Math.abs(sltp.takeProfit - entryP);
                    const total = slDist + tpDist || 1;
                    const slPct = (slDist / total) * 100;
                    return (
                      <>
                        <div className="bg-red-500/60 h-full" style={{ width: `${slPct}%` }} />
                        <div className="bg-emerald-500/60 h-full" style={{ width: `${100 - slPct}%` }} />
                      </>
                    );
                  })()}
                </div>
                <div className="flex justify-center text-[10px]">
                  <span className="text-foreground font-medium">Entry ({entryPremium || '—'})</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// SUB-TAB 3: Positions
// ══════════════════════════════════════════════════════════════

function PositionsTab() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [summary, setSummary] = useState({ totalMargin: 0, totalUnrealizedPnl: 0, positionCount: 0 });
  const [loading, setLoading] = useState(true);
  const [closeId, setCloseId] = useState<string | null>(null);
  const [closePremium, setClosePremium] = useState('');
  const [closeReason, setCloseReason] = useState('MANUAL');
  const [showAll, setShowAll] = useState(false);
  const [allTrades, setAllTrades] = useState<any[]>([]);

  const fetchPositions = useCallback(async () => {
    setLoading(true);
    const [posData, tradesData] = await Promise.all([
      fetchSafe('/api/options/positions'),
      fetchSafe('/api/options/trades?status=ALL'),
    ]);
    if (posData?.success) {
      setPositions(posData.positions);
      setSummary(posData.summary);
    }
    if (tradesData?.success) {
      setAllTrades(tradesData.trades || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchPositions(); }, []);

  const handleClose = async () => {
    if (!closeId || !closePremium) return;
    await fetch('/api/options/trades', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: closeId, exitPremium: parseFloat(closePremium), exitReason: closeReason }),
    }).catch(() => null);
    setCloseId(null);
    setClosePremium('');
    fetchPositions();
  };

  const displayTrades = showAll ? allTrades : positions;

  return (
    <div className="space-y-4">
      {/* Summary Bar */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground">Total Margin</div>
          <div className="text-lg font-bold">₹{summary.totalMargin.toLocaleString()}</div>
        </Card>
        <Card className={cn('p-3', summary.totalUnrealizedPnl >= 0 ? 'border-emerald-500/20' : 'border-red-500/20')}>
          <div className="text-[10px] text-muted-foreground">Unrealized P&L</div>
          <div className={cn('text-lg font-bold', summary.totalUnrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            ₹{summary.totalUnrealizedPnl.toLocaleString()}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground">Open Positions</div>
          <div className="text-lg font-bold">{summary.positionCount}</div>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant={showAll ? 'outline' : 'default'}
          size="sm"
          onClick={() => setShowAll(false)}
          className="h-7 text-xs"
        >
          Open ({positions.length})
        </Button>
        <Button
          variant={showAll ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowAll(true)}
          className="h-7 text-xs"
        >
          All Trades ({allTrades.length})
        </Button>
        <Button variant="ghost" size="sm" onClick={fetchPositions} className="h-7 text-xs ml-auto">
          <RefreshCw className="h-3 w-3 mr-1" /> Refresh
        </Button>
      </div>

      {/* Position Cards */}
      {loading ? (
        <div className="text-center text-muted-foreground text-sm py-8">Loading positions...</div>
      ) : displayTrades.length === 0 ? (
        <div className="text-center text-muted-foreground text-sm py-8">No trades yet. Create one from the New Trade tab.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {displayTrades.map((trade: any) => {
            const pnl = trade.unrealizedPnl ?? trade.pnl ?? 0;
            const pnlPct = trade.unrealizedPnlPct ?? trade.pnlPercent ?? 0;
            const isOpen = trade.status === 'OPEN';
            const dte = trade.expiryDate ? Math.max(0, Math.ceil((new Date(trade.expiryDate + 'T15:30:00+05:30').getTime() - Date.now()) / 86400000)) : 0;

            return (
              <Card key={trade.id} className={cn('overflow-hidden', !isOpen && 'opacity-60')}>
                <CardContent className="p-3 space-y-2">
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">{trade.symbol}</span>
                      <Badge variant="outline" className={cn('text-[10px] px-1.5', trade.optionType === 'CE' ? 'border-emerald-500/50 text-emerald-400' : 'border-red-500/50 text-red-400')}>
                        {trade.optionType}
                      </Badge>
                      <Badge variant="outline" className={cn('text-[10px] px-1.5', trade.action === 'BUY' ? 'border-blue-500/50 text-blue-400' : 'border-orange-500/50 text-orange-400')}>
                        {trade.action}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] px-1.5">
                        {trade.strikePrice}
                      </Badge>
                    </div>
                    {isOpen && dte < 2 && (
                      <Badge className="bg-red-500/20 text-red-400 border-0 text-[10px]">⚠ {dte}d left</Badge>
                    )}
                  </div>

                  {/* Prices */}
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">Entry</div>
                      <div className="font-medium">₹{trade.entryPremium}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Current</div>
                      <div className="font-medium">₹{trade.currentPremium ?? '—'}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Lot×Qty</div>
                      <div className="font-medium">{trade.lotSize}×{trade.qty}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Expiry</div>
                      <div className={cn('font-medium', dte < 3 && 'text-red-400')}>{trade.expiryDate} ({dte}d)</div>
                    </div>
                  </div>

                  {/* P&L */}
                  <div className={cn(
                    'rounded-lg p-2 text-center text-sm font-bold',
                    pnl >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                  )}>
                    {pnl >= 0 ? '+' : ''}₹{pnl.toLocaleString()} ({pnl >= 0 ? '+' : ''}{fmt(pnlPct)}%)
                  </div>

                  {/* Greeks at Entry */}
                  {(trade.entryDelta != null) && (
                    <div className="flex gap-3 text-[10px] text-muted-foreground">
                      <span>Δ {fmt(trade.entryDelta)}</span>
                      <span>Γ {fmt(trade.entryGamma, 4)}</span>
                      <span>Θ {fmt(trade.entryTheta)}</span>
                      <span>ν {fmt(trade.entryVega)}</span>
                      <span>IV {fmt(trade.entryIV)}%</span>
                    </div>
                  )}

                  {/* SL/TP */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-red-400">SL: ₹{trade.stopLoss ?? '—'}</span>
                    <span className="text-emerald-400">TP: ₹{trade.takeProfit ?? '—'}</span>
                    {!isOpen && trade.exitReason && (
                      <Badge variant="outline" className="text-[10px]">{trade.exitReason}</Badge>
                    )}
                  </div>

                  {/* Close Button */}
                  {isOpen && (
                    <Dialog open={closeId === trade.id} onOpenChange={(open) => !open && setCloseId(null)}>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm" className="w-full h-7 text-xs" onClick={() => setCloseId(trade.id)}>
                          Close Position
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-sm">
                        <DialogHeader>
                          <DialogTitle className="text-sm">Close Position</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-3">
                          <div className="text-xs text-muted-foreground">
                            {trade.symbol} {trade.strikePrice} {trade.optionType} {trade.action}
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Exit Premium</Label>
                            <Input type="number" value={closePremium} onChange={(e) => setClosePremium(e.target.value)} className="h-9 text-sm" placeholder={String(trade.currentPremium || trade.entryPremium)} step="0.5" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Exit Reason</Label>
                            <Select value={closeReason} onValueChange={setCloseReason}>
                              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="MANUAL">Manual</SelectItem>
                                <SelectItem value="SL_HIT">Stop Loss Hit</SelectItem>
                                <SelectItem value="TP_HIT">Take Profit Hit</SelectItem>
                                <SelectItem value="THETA_DECAY">Theta Decay</SelectItem>
                                <SelectItem value="EXPIRED">Expired</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <Button onClick={handleClose} className="w-full h-9 bg-indigo-600 hover:bg-indigo-700">
                            Close Trade
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// SUB-TAB 4: Strategies
// ══════════════════════════════════════════════════════════════

function StrategiesTab() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [buildOpen, setBuildOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [buildSymbol, setBuildSymbol] = useState('NIFTY');
  const [buildExpiry, setBuildExpiry] = useState('');
  const [buildExpiries, setBuildExpiries] = useState<string[]>([]);
  const [buildSpot, setBuildSpot] = useState(0);
  const [buildLegs, setBuildLegs] = useState<any[]>([]);
  const [buildNotes, setBuildNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchStrategies = useCallback(async () => {
    setLoading(true);
    const data = await fetchSafe('/api/options/strategies');
    if (data?.success) setStrategies(data.strategies || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchStrategies(); }, []);

  const openBuilder = async (template: any) => {
    setSelectedTemplate(template);
    setBuildOpen(true);
    // Load chain data for strike selection
    const data = await fetchSafe(`/api/options/chain?symbol=${buildSymbol}`);
    if (data?.success) {
      setBuildExpiries(data.expiryDates || []);
      setBuildExpiry(data.expiryDate || '');
      setBuildSpot(data.underlyingPrice || 0);
    }
  };

  // Generate leg strikes based on template and spot
  useEffect(() => {
    if (!selectedTemplate || !buildSpot) return;
    const step = buildSymbol === 'BANKNIFTY' ? 100 : 50;
    const atm = Math.round(buildSpot / step) * step;

    const legs = selectedTemplate.legs.map((leg: any) => {
      const strike = atm + leg.strikeOffset * step;
      return {
        optionType: leg.optionType,
        action: leg.action,
        strikePrice: strike,
        lotSize: 1, // will be filled properly
        qty: 1,
        entryPremium: 0, // will be calculated
      };
    });
    setBuildLegs(legs);
  }, [selectedTemplate, buildSpot, buildSymbol]);

  const handleBuildStrategy = async () => {
    if (!selectedTemplate || buildLegs.length === 0) return;
    setSubmitting(true);

    // For each leg, estimate premium using BS
    const { timeToExpiryYears } = await import('@/lib/options/black-scholes');
    const { blackScholes } = await import('@/lib/options/black-scholes');
    const T = timeToExpiryYears(buildExpiry);
    const r = 0.07;

    const legsPayload = buildLegs.map((leg: any) => {
      const iv = buildSymbol === 'NIFTY' || buildSymbol === 'BANKNIFTY' ? 0.13 : 0.25;
      const bs = blackScholes(buildSpot, leg.strikePrice, T, r, iv, leg.optionType);
      return {
        ...leg,
        entryPremium: Math.round(bs.premium * 100) / 100,
        lotSize: leg.lotSize || 25,
      };
    });

    const res = await fetch('/api/options/strategies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: selectedTemplate.name,
        symbol: buildSymbol,
        legs: legsPayload,
        expiryDate: buildExpiry,
        notes: buildNotes,
        underlyingPrice: buildSpot,
      }),
    }).catch(() => null);

    const data = res ? await safeJson(res) : null;
    if (data?.success) {
      fetchStrategies();
      setBuildOpen(false);
    }
    setSubmitting(false);
  };

  return (
    <div className="space-y-4">
      {/* Strategy Templates */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {STRATEGY_TEMPLATES.map((tpl) => (
          <Card key={tpl.id} className="hover:border-indigo-500/30 transition-colors">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">{tpl.name}</h3>
                <Zap className="h-4 w-4 text-indigo-400" />
              </div>
              <p className="text-xs text-muted-foreground">{tpl.description}</p>
              <div className="flex items-center gap-1.5 text-xs">
                <Info className="h-3 w-3 text-amber-400" />
                <span className="text-amber-400">{tpl.condition}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {tpl.legs.map((leg, i) => (
                  <Badge key={i} variant="outline" className="text-[10px]">
                    {leg.action} {leg.optionType} ({leg.strikeOffset > 0 ? '+' : ''}{leg.strikeOffset})
                  </Badge>
                ))}
              </div>
              <Button size="sm" className="w-full h-7 text-xs bg-indigo-600 hover:bg-indigo-700" onClick={() => openBuilder(tpl)}>
                Build Strategy
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Separator />

      {/* Active Strategies */}
      <h3 className="text-sm font-semibold">Active Strategies</h3>
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : strategies.filter((s) => s.status === 'OPEN').length === 0 ? (
        <p className="text-xs text-muted-foreground">No active strategies</p>
      ) : (
        <div className="space-y-2">
          {strategies.filter((s) => s.status === 'OPEN').map((s) => {
            const legs: any[] = [];
            try { legs.push(...JSON.parse(s.legs)); } catch { /* ignore */ }
            return (
              <Card key={s.id} className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{s.name}</span>
                    <Badge variant="outline" className="text-[10px]">{s.symbol}</Badge>
                    <Badge variant="outline" className="text-[10px]">{s.expiryDate}</Badge>
                  </div>
                  <div className={cn('text-sm font-bold', s.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {s.totalPnl >= 0 ? '+' : ''}₹{s.totalPnl.toLocaleString()}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {legs.map((leg: any, i: number) => (
                    <Badge key={i} variant="outline" className="text-[10px]">
                      {leg.action} {leg.optionType} {leg.strikePrice}
                    </Badge>
                  ))}
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>Margin: ₹{s.totalMargin.toLocaleString()}</span>
                  <span>Trades: {s.trades?.length || 0}</span>
                  <span>Spot: {s.underlyingPrice}</span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Strategy Builder Dialog */}
      <Dialog open={buildOpen} onOpenChange={setBuildOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">Build {selectedTemplate?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Symbol</Label>
                <Select value={buildSymbol} onValueChange={setBuildSymbol}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SYMBOLS.filter((s) => ['NIFTY', 'BANKNIFTY', 'FINNIFTY'].includes(s)).map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Expiry</Label>
                <Select value={buildExpiry} onValueChange={setBuildExpiry}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {buildExpiries.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {buildSpot > 0 && (
              <div className="text-xs text-muted-foreground">
                Spot: <span className="text-foreground font-medium">{buildSpot}</span> | ATM Strike: {Math.round(buildSpot / (buildSymbol === 'BANKNIFTY' ? 100 : 50)) * (buildSymbol === 'BANKNIFTY' ? 100 : 50)}
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs font-medium">Strategy Legs</Label>
              <div className="space-y-1.5">
                {buildLegs.map((leg: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg bg-secondary/30 p-2 text-xs">
                    <Badge variant="outline" className={cn('text-[10px]', leg.action === 'BUY' ? 'border-emerald-500/50 text-emerald-400' : 'border-red-500/50 text-red-400')}>
                      {leg.action}
                    </Badge>
                    <Badge variant="outline" className={cn('text-[10px]', leg.optionType === 'CE' ? 'border-emerald-500/50 text-emerald-400' : 'border-red-500/50 text-red-400')}>
                      {leg.optionType}
                    </Badge>
                    <Input
                      type="number"
                      value={leg.strikePrice}
                      onChange={(e) => {
                        const updated = [...buildLegs];
                        updated[i] = { ...leg, strikePrice: parseInt(e.target.value) || 0 };
                        setBuildLegs(updated);
                      }}
                      className="h-7 w-24 text-xs"
                    />
                    <Input
                      type="number"
                      value={leg.entryPremium || ''}
                      onChange={(e) => {
                        const updated = [...buildLegs];
                        updated[i] = { ...leg, entryPremium: parseFloat(e.target.value) || 0 };
                        setBuildLegs(updated);
                      }}
                      className="h-7 w-20 text-xs"
                      placeholder="Premium"
                    />
                  </div>
                ))}
              </div>
            </div>

            <Textarea value={buildNotes} onChange={(e) => setBuildNotes(e.target.value)} className="text-sm min-h-[50px]" placeholder="Strategy notes..." />

            <Button onClick={handleBuildStrategy} disabled={submitting} className="w-full h-9 bg-indigo-600 hover:bg-indigo-700">
              {submitting ? 'Creating Strategy...' : 'Create Strategy'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// SUB-TAB 5: Analytics
// ══════════════════════════════════════════════════════════════

function AnalyticsTab() {
  const [trades, setTrades] = useState<any[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const [tData, pData] = await Promise.all([
        fetchSafe('/api/options/trades?status=ALL'),
        fetchSafe('/api/options/positions'),
      ]);
      if (tData?.success) setTrades(tData.trades || []);
      if (pData?.success) setPositions(pData.positions || []);
      setLoading(false);
    };
    load();
  }, []);

  const closedTrades = trades.filter((t) => t.status !== 'OPEN');
  const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const wins = closedTrades.filter((t) => (t.pnl || 0) > 0).length;
  const losses = closedTrades.filter((t) => (t.pnl || 0) <= 0).length;
  const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;
  const avgPnl = closedTrades.length > 0 ? totalPnl / closedTrades.length : 0;

  // P&L by exit reason
  const pnlByReason = useMemo(() => {
    const map: Record<string, number> = {};
    closedTrades.forEach((t) => {
      const reason = t.exitReason || 'UNKNOWN';
      map[reason] = (map[reason] || 0) + (t.pnl || 0);
    });
    return Object.entries(map).map(([reason, pnl]) => ({ reason, pnl: Math.round(pnl) }));
  }, [closedTrades]);

  // OI-based sentiment from positions (using entry IV as proxy)
  const sentimentData = useMemo(() => {
    const ceTrades = positions.filter((p) => p.optionType === 'CE');
    const peTrades = positions.filter((p) => p.optionType === 'PE');
    const ceTotal = ceTrades.reduce((sum, p) => sum + p.entryPremium * p.lotSize * p.qty, 0);
    const peTotal = peTrades.reduce((sum, p) => sum + p.entryPremium * p.lotSize * p.qty, 0);
    return [
      { name: 'Call (CE)', value: Math.round(ceTotal) || 1, fill: '#10b981' },
      { name: 'Put (PE)', value: Math.round(peTotal) || 1, fill: '#ef4444' },
    ];
  }, [positions]);

  // Daily P&L trend (group by exitDate)
  const pnlTrend = useMemo(() => {
    const map: Record<string, number> = {};
    closedTrades.forEach((t) => {
      if (t.exitDate) {
        const day = new Date(t.exitDate).toISOString().split('T')[0];
        map[day] = (map[day] || 0) + (t.pnl || 0);
      }
    });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, pnl]) => ({ date, pnl: Math.round(pnl) }));
  }, [closedTrades]);

  // Theta decay analysis
  const thetaAnalysis = useMemo(() => {
    const totalThetaPerDay = trades
      .filter((t) => t.entryTheta && t.status === 'OPEN')
      .reduce((sum, t) => {
        const shares = t.lotSize * t.qty;
        const thetaPerShare = Math.abs(t.entryTheta || 0);
        return sum + thetaPerShare * shares * (t.action === 'BUY' ? -1 : 1);
      }, 0);
    return totalThetaPerDay;
  }, [trades]);

  if (loading) {
    return <div className="text-center text-muted-foreground text-sm py-8">Loading analytics...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground">Total Trades</div>
          <div className="text-xl font-bold">{trades.length}</div>
          <div className="text-[10px] text-muted-foreground">{positions.length} open</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground">Win Rate</div>
          <div className={cn('text-xl font-bold', winRate >= 50 ? 'text-emerald-400' : 'text-red-400')}>
            {winRate.toFixed(1)}%
          </div>
          <div className="text-[10px] text-muted-foreground">{wins}W / {losses}L</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground">Total P&L</div>
          <div className={cn('text-xl font-bold', totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            ₹{totalPnl.toLocaleString()}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground">Avg P&L/Trade</div>
          <div className={cn('text-xl font-bold', avgPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            ₹{avgPnl.toFixed(0)}
          </div>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* P&L Trend */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold">P&L by Trade</CardTitle>
          </CardHeader>
          <CardContent>
            {pnlTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={pnlTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 11 }}
                    formatter={(value: number) => [`₹${value}`, 'P&L']}
                  />
                  <Bar dataKey="pnl" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground text-xs">No closed trades yet</div>
            )}
          </CardContent>
        </Card>

        {/* OI Sentiment */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold">Open Position Sentiment</CardTitle>
          </CardHeader>
          <CardContent>
            {positions.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={sentimentData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 11 }}
                    formatter={(value: number) => [`₹${value}`, 'Premium']}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {sentimentData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground text-xs">No open positions</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* P&L by Exit Reason */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold">P&L by Exit Reason</CardTitle>
          </CardHeader>
          <CardContent>
            {pnlByReason.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={pnlByReason}
                    dataKey="pnl"
                    nameKey="reason"
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    label={({ reason, pnl }) => `${reason}: ₹${pnl}`}
                    labelLine={{ stroke: 'hsl(var(--muted-foreground))' }}
                  >
                    {pnlByReason.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 11 }}
                    formatter={(value: number) => [`₹${value}`, 'P&L']}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground text-xs">No closed trades</div>
            )}
          </CardContent>
        </Card>

        {/* Theta Decay Analysis */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold">Theta Decay (Open Positions)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg bg-secondary/30 p-4 text-center">
              <div className="text-[10px] text-muted-foreground mb-1">Net Theta / Day</div>
              <div className={cn('text-2xl font-bold', thetaAnalysis < 0 ? 'text-red-400' : 'text-emerald-400')}>
                {thetaAnalysis < 0 ? '-' : '+'}₹{Math.abs(thetaAnalysis).toFixed(0)}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {thetaAnalysis < 0 ? 'Paying theta (net buyer)' : 'Collecting theta (net seller)'}
              </div>
            </div>

            {/* Per-position theta breakdown */}
            {positions.filter((p) => p.entryTheta != null).length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] text-muted-foreground font-medium">Per Position:</div>
                {positions.filter((p) => p.entryTheta != null).map((p) => {
                  const dailyTheta = (p.entryTheta || 0) * p.lotSize * p.qty * (p.action === 'BUY' ? -1 : 1);
                  return (
                    <div key={p.id} className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0">
                      <span>{p.symbol} {p.strikePrice} {p.optionType}</span>
                      <span className={cn(dailyTheta < 0 ? 'text-red-400' : 'text-emerald-400')}>
                        {dailyTheta < 0 ? '-' : '+'}₹{Math.abs(dailyTheta).toFixed(0)}/day
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}