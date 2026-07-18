'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  BarChart3, TrendingUp, Shield, Bell, Plus, X, RefreshCw, Trash2,
  Target, PieChart as PieIcon, AlertTriangle, CheckCircle2, Loader2,
  ArrowUpRight, ArrowDownRight, Scale,
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Cell, Legend, ComposedChart,
} from 'recharts';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ── Risk Metrics Card ─────────────────────────────────
function RiskMetricsCard() {
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/portfolio/risk-metrics');
      const data = await res.json();
      if (data.success) setMetrics(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

  if (loading) return <div className="text-center py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 mx-auto animate-spin" /></div>;
  if (!metrics || metrics.tradeCount < 2) return <p className="text-center py-8 text-muted-foreground text-sm">Need at least 2 closed trades for risk metrics.</p>;

  const m = metrics.metrics;
  const items = [
    { label: 'Sharpe Ratio', value: m.sharpe.toFixed(2), color: m.sharpe >= 1 ? 'text-emerald-400' : m.sharpe >= 0 ? 'text-amber-400' : 'text-red-400', desc: m.sharpe >= 1 ? 'Good' : m.sharpe >= 0 ? 'Moderate' : 'Poor' },
    { label: 'Sortino Ratio', value: m.sortino.toFixed(2), color: m.sortino >= 1.5 ? 'text-emerald-400' : 'text-amber-400', desc: 'Downside risk adjusted' },
    { label: 'Max Drawdown', value: `${m.maxDD.toFixed(1)}%`, color: 'text-red-400', desc: 'Worst peak-to-trough' },
    { label: 'Calmar Ratio', value: m.calmar.toFixed(2), color: m.calmar >= 1 ? 'text-emerald-400' : 'text-amber-400', desc: 'Return / MaxDD' },
    { label: 'VaR (95%)', value: `${m.var95.toFixed(2)}%`, color: 'text-red-400', desc: 'Worst 5% day loss' },
    { label: 'CAGR', value: `${m.cagr.toFixed(1)}%`, color: m.cagr >= 15 ? 'text-emerald-400' : 'text-amber-400', desc: 'Annualized return' },
    { label: 'Expectancy', value: `${m.expectancy?.toFixed(2) || 0}%`, color: (m.expectancy || 0) > 0 ? 'text-emerald-400' : 'text-red-400', desc: 'Avg win% x WR - Avg loss% x LR' },
    { label: 'Avg R-Multiple', value: `${m.avgRMultiple?.toFixed(2) || 0}R`, color: (m.avgRMultiple || 0) >= 1 ? 'text-emerald-400' : 'text-red-400', desc: 'Avg profit / risk per trade' },
    { label: 'Profit Factor', value: m.profitFactor?.toFixed(2) || '0', color: (m.profitFactor || 0) >= 1.5 ? 'text-emerald-400' : 'text-amber-400', desc: 'Gross profit / gross loss' },
    { label: 'Avg Holding', value: `${m.avgHoldingDays}d`, color: 'text-indigo-400', desc: 'Average trade duration' },
    { label: 'Best Trade', value: `${m.bestTrade?.toFixed(1) || 0}%`, color: 'text-emerald-400', desc: '' },
    { label: 'Worst Trade', value: `${m.worstTrade?.toFixed(1) || 0}%`, color: 'text-red-400', desc: '' },
  ];

  return (
    <div className="grid grid-cols-3 lg:grid-cols-3 xl:grid-cols-3 gap-3">
      {items.map(item => (
        <div key={item.label} className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">{item.label}</div>
          <div className={cn('text-lg font-bold font-mono mt-0.5', item.color)}>{item.value}</div>
          {item.desc && <div className="text-[10px] text-muted-foreground mt-0.5">{item.desc}</div>}
        </div>
      ))}
    </div>
  );
}

// ── Benchmark Comparison ────────────────────────────────
function BenchmarkChart() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/portfolio/benchmark?days=90');
        const json = await res.json();
        if (json.success) setData(json.benchmark);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="text-center py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 mx-auto animate-spin" /></div>;
  if (!data || !data.chartData?.length) return <p className="text-center py-8 text-muted-foreground text-sm">No benchmark data available.</p>;

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Portfolio Return</div>
          <div className={cn('text-lg font-bold font-mono', data.portfolioTotalReturn >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {data.portfolioTotalReturn >= 0 ? '+' : ''}₹{data.portfolioTotalReturn.toLocaleString()}
          </div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Nifty 50 Return</div>
          <div className={cn('text-lg font-bold font-mono', data.niftyTotalReturn >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {data.niftyTotalReturn >= 0 ? '+' : ''}{data.niftyTotalReturn.toFixed(2)}%
          </div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Alpha / Beta</div>
          <div className="text-lg font-bold font-mono text-indigo-400">
            {data.alpha}%
            {data.beta != null && <span className="text-xs text-muted-foreground ml-1">β{data.beta}</span>}
          </div>
        </div>
      </div>
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#71717a' }} interval={Math.floor(data.chartData.length / 6)} />
            <YAxis tick={{ fontSize: 10, fill: '#71717a' }} />
            <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="portfolio" stroke="#6366f1" strokeWidth={2} name="Portfolio (₹)" dot={false} />
            <Line type="monotone" dataKey="nifty" stroke="#10b981" strokeWidth={1.5} name="Nifty 50 (%)" dot={false} strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Price Alerts ────────────────────────────────────────
function AlertsPanel() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ symbol: '', condition: 'ABOVE', targetPrice: '', notes: '' });
  const [checking, setChecking] = useState(false);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/portfolio/alerts');
      const data = await res.json();
      if (data.success) setAlerts(data.alerts);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  const createAlert = async () => {
    if (!form.symbol || !form.targetPrice) return;
    try {
      const res = await fetch('/api/portfolio/alerts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Alert set: ${form.symbol} ${form.condition} ₹${form.targetPrice}`);
        setForm({ symbol: '', condition: 'ABOVE', targetPrice: '', notes: '' });
        setOpen(false);
        fetchAlerts();
      }
    } catch { toast.error('Failed to create alert'); }
  };

  const deleteAlert = async (id: string) => {
    await fetch(`/api/portfolio/alerts?id=${id}`, { method: 'DELETE' });
    fetchAlerts();
  };

  const checkAlerts = async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/portfolio/alerts', { method: 'PUT' });
      const data = await res.json();
      if (data.success && data.triggered.length > 0) {
        for (const t of data.triggered) {
          toast.success(`🔔 ${t.symbol} hit ₹${t.triggeredPrice}!`, {
            description: `Target: ₹${t.targetPrice} ${t.condition}`,
            duration: 8000,
          });
        }
        fetchAlerts();
      } else {
        toast.info('No alerts triggered');
      }
    } catch { toast.error('Failed to check alerts'); }
    finally { setChecking(false); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Bell className="h-4 w-4" /> Price Alerts</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={checkAlerts} disabled={checking} className="h-7 text-xs gap-1">
            {checking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Target className="h-3 w-3" />} Check
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm" className="h-7 text-xs gap-1"><Plus className="h-3 w-3" /> New Alert</Button></DialogTrigger>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader><DialogTitle>Create Price Alert</DialogTitle></DialogHeader>
              <div className="grid gap-3 py-2">
                <div><Label className="text-xs">Symbol</Label>
                  <Input value={form.symbol} onChange={e => setForm({ ...form, symbol: e.target.value.toUpperCase() })} placeholder="RELIANCE" className="h-8 text-xs" /></div>
                <div><Label className="text-xs">Condition</Label>
                  <Select value={form.condition} onValueChange={v => setForm({ ...form, condition: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="ABOVE">Price goes ABOVE</SelectItem><SelectItem value="BELOW">Price goes BELOW</SelectItem></SelectContent>
                  </Select></div>
                <div><Label className="text-xs">Target Price (₹)</Label>
                  <Input type="number" value={form.targetPrice} onChange={e => setForm({ ...form, targetPrice: e.target.value })} placeholder="2500" className="h-8 text-xs" /></div>
              </div>
              <DialogFooter>
                <DialogClose asChild><Button variant="ghost" size="sm">Cancel</Button></DialogClose>
                <Button size="sm" onClick={createAlert}>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      {alerts.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">No alerts set. Create one to get notified when a price target is hit.</p>
      ) : (
        <ScrollArea className="max-h-[200px]">
          <div className="space-y-1.5 pr-2">
            {alerts.slice(0, 20).map(a => (
              <div key={a.id} className="flex items-center gap-2 text-xs py-1.5 border-b border-border/30">
                <div className={cn('h-2 w-2 rounded-full shrink-0', a.triggered ? 'bg-amber-400' : 'bg-blue-400')} />
                <span className="font-semibold">{a.symbol}</span>
                <Badge variant="outline" className="text-[9px] h-4">{a.condition}</Badge>
                <span className="font-mono">₹{a.targetPrice.toLocaleString()}</span>
                {a.triggered && <Badge className="text-[9px] h-4 bg-amber-500/20 text-amber-400">HIT ₹{a.triggeredPrice}</Badge>}
                <button onClick={() => deleteAlert(a.id)} className="ml-auto text-muted-foreground hover:text-red-400"><X className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// ── Capital Gains Report ────────────────────────────────
function CapitalGainsReport() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/portfolio/capital-gains');
        const json = await res.json();
        if (json.success) setData(json);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="text-center py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 mx-auto animate-spin" /></div>;
  if (!data || (data.stcg.length === 0 && data.ltcg.length === 0)) return <p className="text-center py-8 text-muted-foreground text-sm">No closed trades for capital gains report.</p>;

  const s = data.summary;
  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="rounded-lg bg-red-500/10 p-3">
          <div className="text-[10px] text-red-400 uppercase">STCG ({s.stcgRate})</div>
          <div className="text-lg font-bold font-mono text-red-400">₹{Math.round(s.totalSTCG).toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground">Tax: ₹{s.stcgTax.toLocaleString()}</div>
        </div>
        <div className="rounded-lg bg-blue-500/10 p-3">
          <div className="text-[10px] text-blue-400 uppercase">LTCG ({s.ltcgRate})</div>
          <div className="text-lg font-bold font-mono text-blue-400">₹{Math.round(s.totalLTCG).toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground">Tax: ₹{s.ltcgTax.toLocaleString()}</div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Exemption</div>
          <div className="text-lg font-bold font-mono">₹{s.ltcgExemption.toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground">LTCG threshold</div>
        </div>
        <div className="rounded-lg bg-amber-500/10 p-3">
          <div className="text-[10px] text-amber-400 uppercase">Total Tax Est.</div>
          <div className="text-lg font-bold font-mono text-amber-400">₹{s.totalTax.toLocaleString()}</div>
        </div>
      </div>
      {data.byFinancialYear.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold mb-2">By Financial Year</h4>
          <ScrollArea className="max-h-[150px]">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-1 font-medium">FY</th><th className="text-right py-1 font-medium">STCG</th>
                <th className="text-right py-1 font-medium">LTCG</th><th className="text-right py-1 font-medium">Tax</th>
              </tr></thead>
              <tbody>
                {data.byFinancialYear.map((fy: any) => (
                  <tr key={fy.fy} className="border-b border-border/30">
                    <td className="py-1 font-mono">{fy.fy}</td>
                    <td className={cn('text-right py-1 font-mono', fy.stcg >= 0 ? 'text-red-400' : 'text-emerald-400')}>{fy.stcg >= 0 ? '+' : ''}₹{fy.stcg.toLocaleString()}</td>
                    <td className={cn('text-right py-1 font-mono', fy.ltcg >= 0 ? 'text-red-400' : 'text-emerald-400')}>{fy.ltcg >= 0 ? '+' : ''}₹{fy.ltcg.toLocaleString()}</td>
                    <td className="text-right py-1 font-mono text-amber-400">₹{(fy.stcgTax + fy.ltcgTax).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </div>
      )}
      <ScrollArea className="max-h-[200px]">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-border text-muted-foreground">
            <th className="text-left py-1 font-medium">Symbol</th><th className="text-right py-1 font-medium">P&L</th>
            <th className="text-right py-1 font-medium">Type</th><th className="text-right py-1 font-medium">Days</th>
            <th className="text-right py-1 font-medium">Exit</th>
          </tr></thead>
          <tbody>
            {[...data.stcg.map((t: any) => ({ ...t, type: 'STCG' })), ...data.ltcg.map((t: any) => ({ ...t, type: 'LTCG' }))]
              .sort((a: any, b: any) => new Date(b.exitDate).getTime() - new Date(a.exitDate).getTime())
              .slice(0, 20)
              .map((t: any) => (
                <tr key={t.id} className="border-b border-border/30">
                  <td className="py-1 font-semibold">{t.symbol}</td>
                  <td className={cn('text-right py-1 font-mono', (t.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {(t.pnl || 0) >= 0 ? '+' : ''}₹{Math.round(t.pnl || 0).toLocaleString()}
                  </td>
                  <td className="text-right py-1"><Badge variant="outline" className={cn('text-[9px] h-4', t.type === 'LTCG' ? 'text-blue-400' : 'text-red-400')}>{t.type}</Badge></td>
                  <td className="text-right py-1 font-mono text-muted-foreground">{t.holdingDays}d</td>
                  <td className="text-right py-1 text-muted-foreground">{new Date(t.exitDate).toLocaleDateString()}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

// ── Rebalance Tool ─────────────────────────────────────
function RebalancePanel() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchRebalance = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/portfolio/rebalance');
      const json = await res.json();
      if (json.success) setData(json.rebalance);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchRebalance(); }, [fetchRebalance]);

  if (loading) return <div className="text-center py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 mx-auto animate-spin" /></div>;
  if (!data || data.allocations.length === 0) return <p className="text-center py-8 text-muted-foreground text-sm">Open some positions to see rebalancing suggestions.</p>;

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Portfolio Value</div>
          <div className="text-lg font-bold font-mono">₹{data.totalValue.toLocaleString()}</div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Cash Available</div>
          <div className="text-lg font-bold font-mono text-emerald-400">₹{data.cashAvailable.toLocaleString()}</div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Sectors</div>
          <div className="text-lg font-bold font-mono text-indigo-400">{data.sectorCount}</div>
        </div>
      </div>

      {data.actions.length > 0 && (
        <div className="mb-4 space-y-1.5">
          <h4 className="text-xs font-semibold flex items-center gap-1"><Scale className="h-3 w-3" /> Suggested Actions</h4>
          {data.actions.map((a: any, i: number) => (
            <div key={i} className={cn('flex items-center gap-2 text-xs p-2 rounded-lg',
              a.type === 'REDUCE' ? 'bg-red-500/10' : 'bg-emerald-500/10')}>
              {a.type === 'REDUCE' ? <ArrowDownRight className="h-3 w-3 text-red-400" /> : <ArrowUpRight className="h-3 w-3 text-emerald-400" />}
              <Badge variant="outline" className={cn('text-[9px] h-4', a.type === 'REDUCE' ? 'text-red-400' : 'text-emerald-400')}>{a.type}</Badge>
              <span>{a.note}</span>
              <span className="ml-auto font-mono">₹{a.amount.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}

      <h4 className="text-xs font-semibold mb-2">Sector Allocation</h4>
      <ScrollArea className="max-h-[180px]">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-border text-muted-foreground">
            <th className="text-left py-1 font-medium">Sector</th>
            <th className="text-right py-1 font-medium">Value</th>
            <th className="text-right py-1 font-medium">Now</th>
            <th className="text-right py-1 font-medium">Target</th>
            <th className="text-right py-1 font-medium">Diff</th>
          </tr></thead>
          <tbody>
            {data.allocations.map((a: any) => (
              <tr key={a.sector} className="border-b border-border/30">
                <td className="py-1">{a.sector}</td>
                <td className="text-right py-1 font-mono">₹{a.value.toLocaleString()}</td>
                <td className="text-right py-1 font-mono">{a.currentPct}%</td>
                <td className="text-right py-1 font-mono text-muted-foreground">{a.targetPct}%</td>
                <td className={cn('text-right py-1 font-mono', Math.abs(a.diff) > 10 ? (a.diff > 0 ? 'text-red-400' : 'text-emerald-400') : 'text-muted-foreground')}>
                  {a.diff > 0 ? '+' : ''}{a.diff}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

// ── SIP Tracker (Analytics version) ────────────────────
function SIPTracker() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/portfolio/sip');
        const d = await res.json();
        if (d.success) setData(d);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);
  if (loading) return <div className="text-center py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 mx-auto animate-spin" /></div>;
  if (!data || data.plans.length === 0) return <p className="text-center py-8 text-muted-foreground text-sm">No active SIP plans. Create one in Settings → SIP Plans.</p>;
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Total Invested</div>
          <div className="text-lg font-bold font-mono">₹{Math.round(data.totalInvested).toLocaleString()}</div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Current Value</div>
          <div className={cn('text-lg font-bold font-mono', (data.totalCurrentValue - data.totalInvested) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            ₹{Math.round(data.totalCurrentValue).toLocaleString()}
          </div>
        </div>
      </div>
      <ScrollArea className="max-h-[300px]">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-border text-muted-foreground">
            <th className="text-left py-1 font-medium">Symbol</th><th className="text-right py-1 font-medium">Amount</th>
            <th className="text-right py-1 font-medium">Frequency</th><th className="text-right py-1 font-medium">Installments</th>
            <th className="text-right py-1 font-medium">Avg Price</th><th className="text-right py-1 font-medium">Return</th>
          </tr></thead>
          <tbody>
            {data.plans.map((p: any) => (
              <tr key={p.id} className="border-b border-border/30">
                <td className="py-1.5 font-semibold">{p.symbol}</td>
                <td className="text-right py-1.5 font-mono">₹{p.amount.toLocaleString()}</td>
                <td className="text-right py-1.5"><Badge variant="outline" className="text-[9px] h-4">{p.frequency}</Badge></td>
                <td className="text-right py-1.5 font-mono">{p.installmentsCompleted}</td>
                <td className="text-right py-1.5 font-mono">₹{p.avgPrice > 0 ? p.avgPrice.toFixed(1) : '—'}</td>
                <td className={cn('text-right py-1.5 font-mono', p.returnPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {p.returnPct.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

// ── Dividend Tracker (Analytics version) ───────────────
function DividendTracker() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/portfolio/dividends');
        const d = await res.json();
        if (d.success) setData(d);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);
  if (loading) return <div className="text-center py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 mx-auto animate-spin" /></div>;
  if (!data || data.dividends.length === 0) return <p className="text-center py-8 text-muted-foreground text-sm">No dividends recorded. Add them in Settings → Dividends.</p>;
  const s = data.summary;
  const byYearEntries = Object.entries(s.byYear).sort((a, b) => b[0].localeCompare(a[0]));
  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="rounded-lg bg-emerald-500/10 p-3">
          <div className="text-[10px] text-emerald-400 uppercase">Total Dividends</div>
          <div className="text-lg font-bold font-mono text-emerald-400">₹{s.totalDividends.toLocaleString()}</div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Stocks</div>
          <div className="text-lg font-bold font-mono">{s.uniqueStocks}</div>
        </div>
        {byYearEntries.slice(0, 2).map(([year, amount]) => (
          <div key={year} className="rounded-lg bg-secondary/50 p-3">
            <div className="text-[10px] text-muted-foreground uppercase">{year}</div>
            <div className="text-lg font-bold font-mono text-emerald-400">₹{Math.round(amount as number).toLocaleString()}</div>
          </div>
        ))}
      </div>
      <h4 className="text-xs font-semibold mb-2">By Stock</h4>
      <ScrollArea className="max-h-[200px]">
        <div className="space-y-1 pr-2">
          {Object.entries(s.bySymbol).slice(0, 15).map(([sym, amt]) => (
            <div key={sym} className="flex items-center justify-between text-xs py-1.5 border-b border-border/30">
              <span className="font-semibold">{sym}</span>
              <span className="font-mono text-emerald-400">₹{Math.round(amt as number).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── R-Multiple Distribution ────────────────────────────
function RMultipleDistribution() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/portfolio/risk-metrics');
        const json = await res.json();
        if (json.success) setData(json);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="text-center py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 mx-auto animate-spin" /></div>;
  if (!data || !data.rMultiples?.length) return <p className="text-center py-8 text-muted-foreground text-sm">No closed trades yet.</p>;

  const rMultiples = data.rMultiples;
  const m = data.metrics;

  // Build histogram buckets
  const buckets: { range: string; count: number; positive: boolean }[] = [];
  const ranges = [
    [-10, -3], [-3, -2], [-2, -1], [-1, -0.5], [-0.5, 0],
    [0, 0.5], [0.5, 1], [1, 1.5], [1.5, 2], [2, 3], [3, 10],
  ];
  for (const [lo, hi] of ranges) {
    const count = rMultiples.filter(r => r >= lo && r < hi).length;
    if (count > 0) buckets.push({ range: `${lo}R to ${hi}R`, count, positive: lo >= 0 });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">R-Multiple Distribution</h3>
        <div className="flex gap-4 text-xs">
          <span className="text-muted-foreground">Avg: <span className={cn('font-bold', (m.avgRMultiple || 0) >= 1 ? 'text-emerald-400' : 'text-red-400')}>{m.avgRMultiple?.toFixed(2) || 0}R</span></span>
          <span className="text-muted-foreground">Expectancy: <span className={cn('font-bold', (m.expectancy || 0) > 0 ? 'text-emerald-400' : 'text-red-400')}>{m.expectancy?.toFixed(2) || 0}%</span></span>
        </div>
      </div>
      <div className="h-[250px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={buckets}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="range" tick={{ fontSize: 9, fill: '#71717a' }} angle={-45} textAnchor="end" height={60} />
            <YAxis tick={{ fontSize: 10, fill: '#71717a' }} />
            <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
            <ReferenceLine x={0} stroke="rgba(255,255,255,0.2)" />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {buckets.map((b, i) => <Cell key={i} fill={b.positive ? '#10b981' : '#ef4444'} fillOpacity={0.8} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Profit Factor</div>
          <div className={cn('text-lg font-bold font-mono', (m.profitFactor || 0) >= 1.5 ? 'text-emerald-400' : 'text-amber-400')}>
            {m.profitFactor?.toFixed(2) || '0'}x
          </div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Avg Win</div>
          <div className="text-lg font-bold font-mono text-emerald-400">{m.avgWin?.toFixed(2) || 0}%</div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Avg Loss</div>
          <div className="text-lg font-bold font-mono text-red-400">{m.avgLoss?.toFixed(2) || 0}%</div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Win Rate</div>
          <div className="text-lg font-bold font-mono text-indigo-400">{m.winRate?.toFixed(1) || 0}%</div>
        </div>
      </div>
    </div>
  );
}

// ── Equity Curve with Drawdown ─────────────────────────
function EquityCurveCard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/portfolio/equity-curve?days=90');
        const json = await res.json();
        if (json.success) setData(json);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="text-center py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 mx-auto animate-spin" /></div>;
  if (!data || !data.chartData?.length) return (
    <div className="text-center py-8">
      <p className="text-sm text-muted-foreground">No equity curve data yet.</p>
      <p className="text-xs text-muted-foreground mt-1">NAV snapshots are taken when you visit Dashboard or Analytics.</p>
    </div>
  );

  const s = data.summary;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Equity Curve & Drawdown</h3>
        <div className="flex gap-3 text-xs">
          <span className="text-muted-foreground">NAV: <span className="font-bold font-mono">₹{s.currentNAV.toLocaleString()}</span></span>
          <span className={cn('font-mono', s.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {s.totalReturn >= 0 ? '+' : ''}{s.totalReturn.toFixed(2)}%
          </span>
        </div>
      </div>
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data.chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#71717a' }} interval={Math.floor(data.chartData.length / 6)} />
            <YAxis yAxisId="nav" tick={{ fontSize: 10, fill: '#71717a' }} />
            <YAxis yAxisId="dd" orientation="right" tick={{ fontSize: 9, fill: '#ef4444' }} />
            <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
            <ReferenceLine yAxisId="dd" y={0} stroke="rgba(255,255,255,0.15)" />
            <Area yAxisId="nav" type="monotone" dataKey="nav" stroke="#6366f1" fill="url(#navGrad)" strokeWidth={2} name="NAV" dot={false} />
            <Bar yAxisId="dd" dataKey="drawdown" fill="#ef4444" fillOpacity={0.3} name="Drawdown %" />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <defs>
              <linearGradient id="navGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                <stop offset="95%" stopColor="transparent" stopOpacity={0} />
              </linearGradient>
            </defs>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { l: 'Total Return', v: `${s.totalReturn >= 0 ? '+' : ''}${s.totalReturn.toFixed(2)}%`, c: s.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400' },
          { l: 'Max Drawdown', v: `-${s.maxDD.toFixed(2)}%`, c: 'text-red-400' },
          { l: 'Best Day', v: `+₹${s.bestDay.toLocaleString()}`, c: 'text-emerald-400' },
          { l: 'Worst Day', v: `₹${s.worstDay.toLocaleString()}`, c: 'text-red-400' },
          { l: 'Positive Days', v: `${s.positiveDays}/${s.snapshots}`, c: 'text-indigo-400' },
        ].map(item => (
          <div key={item.l} className="rounded-lg bg-secondary/50 p-3">
            <div className="text-[10px] text-muted-foreground uppercase">{item.l}</div>
            <div className={cn('text-sm font-bold font-mono mt-0.5', item.c)}>{item.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Analytics Tab ─────────────────────────────────
export function AnalyticsTab() {
  const [trades, setTrades] = useState<any[]>([]);
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/trades');
      const json = await res.json();
      const allTrades = json.trades || [];
      const closed = allTrades.filter((t: any) => t.status === 'CLOSED' && t.pnl != null);

      const wins = closed.filter((t: any) => t.pnl > 0);
      const totalPnL = closed.reduce((s: number, t: any) => s + t.pnl, 0);
      const grossProfit = wins.reduce((s: number, t: any) => s + t.pnl, 0);
      const grossLoss = Math.abs(closed.filter((t: any) => t.pnl <= 0).reduce((s: number, t: any) => s + t.pnl, 0));

      const monthMap = new Map<string, { pnl: number; trades: number }>();
      for (const t of closed) {
        const d = new Date(t.exitDate);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const prev = monthMap.get(key) || { pnl: 0, trades: 0 };
        prev.pnl += t.pnl;
        prev.trades += 1;
        monthMap.set(key, prev);
      }
      const byMonth = Array.from(monthMap.entries()).map(([month, v]) => ({
        month, pnl: Math.round(v.pnl), trades: v.trades,
      })).sort((a, b) => a.month.localeCompare(b.month));

      const buckets = [
        { range: '< -5%', min: -Infinity, max: -5 }, { range: '-5% to -2%', min: -5, max: -2 },
        { range: '-2% to 0%', min: -2, max: 0 }, { range: '0% to 2%', min: 0, max: 2 },
        { range: '2% to 5%', min: 2, max: 5 }, { range: '> 5%', min: 5, max: Infinity },
      ];
      const pnlDistribution = buckets.map(b => ({
        range: b.range,
        count: closed.filter((t: any) => t.pnlPercent >= b.min && t.pnlPercent < b.max).length,
      }));

      let peak = 0, running = 0, maxDD = 0;
      for (const t of closed.sort((a: any, b: any) => new Date(a.exitDate).getTime() - new Date(b.exitDate).getTime())) {
        running += t.pnl;
        peak = Math.max(peak, running);
        maxDD = Math.max(maxDD, (peak - running) / peak * 100);
      }

      setAnalyticsData({
        trades: closed, totalPnL,
        winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
        avgWin: wins.length > 0 ? grossProfit / wins.length : 0,
        avgLoss: closed.length - wins.length > 0 ? grossLoss / (closed.length - wins.length) : 0,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : 0,
        maxDD, byMonth, pnlDistribution,
      });
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  if (loading) return <div className="flex items-center justify-center py-16"><div className="text-center text-muted-foreground"><RefreshCw className="h-6 w-6 mx-auto mb-2 animate-spin" /><p className="text-sm">Loading analytics...</p></div></div>;

  const COLORS = ['#10b981', '#f59e0b', '#6366f1', '#ef4444', '#06b6d4', '#ec4899'];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2"><BarChart3 className="h-5 w-5 text-indigo-400" /> Analytics</h2>
        <Button variant="outline" size="sm" onClick={fetchAnalytics} className="gap-2 h-8 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="w-full justify-start mb-4">
          <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
          <TabsTrigger value="risk" className="text-xs">Risk Metrics</TabsTrigger>
          <TabsTrigger value="rmultiple" className="text-xs">R-Multiples</TabsTrigger>
          <TabsTrigger value="equity" className="text-xs">Equity Curve</TabsTrigger>
          <TabsTrigger value="benchmark" className="text-xs">Benchmark</TabsTrigger>
          <TabsTrigger value="alerts" className="text-xs">Alerts</TabsTrigger>
          <TabsTrigger value="tax" className="text-xs">Capital Gains</TabsTrigger>
          <TabsTrigger value="rebalance" className="text-xs">Rebalance</TabsTrigger>
          <TabsTrigger value="sip" className="text-xs">SIP</TabsTrigger>
          <TabsTrigger value="dividends" className="text-xs">Dividends</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          {analyticsData && analyticsData.trades.length > 0 ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
                <Card><CardContent className="p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total P&L</div>
                  <div className={cn('text-xl font-bold mt-1', analyticsData.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {analyticsData.totalPnL >= 0 ? '+' : ''}₹{Math.round(analyticsData.totalPnL).toLocaleString()}
                  </div>
                </CardContent></Card>
                <Card><CardContent className="p-3">
                  <div className="text-[10px] uppercase tracking-wider text-emerald-400">Win Rate</div>
                  <div className="text-xl font-bold mt-1 text-emerald-400">{analyticsData.winRate.toFixed(1)}%</div>
                </CardContent></Card>
                <Card><CardContent className="p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Profit Factor</div>
                  <div className={cn('text-xl font-bold mt-1', analyticsData.profitFactor >= 1.5 ? 'text-emerald-400' : analyticsData.profitFactor >= 1 ? 'text-amber-400' : 'text-red-400')}>
                    {analyticsData.profitFactor.toFixed(2)}x
                  </div>
                </CardContent></Card>
                <Card><CardContent className="p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg Win</div>
                  <div className="text-xl font-bold mt-1 text-emerald-400">+₹{Math.round(analyticsData.avgWin).toLocaleString()}</div>
                </CardContent></Card>
                <Card><CardContent className="p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg Loss</div>
                  <div className="text-xl font-bold mt-1 text-red-400">-₹{Math.round(analyticsData.avgLoss).toLocaleString()}</div>
                </CardContent></Card>
                <Card><CardContent className="p-3">
                  <div className="text-[10px] uppercase tracking-wider text-red-400">Max Drawdown</div>
                  <div className="text-xl font-bold mt-1 text-red-400">{analyticsData.maxDD.toFixed(1)}%</div>
                </CardContent></Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {analyticsData.byMonth.length > 0 && (
                  <Card className="border-border"><CardContent className="p-4">
                    <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Monthly P&L</h3>
                    <div className="h-52">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={analyticsData.byMonth}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                          <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#71717a' }} />
                          <YAxis tick={{ fontSize: 10, fill: '#71717a' }} />
                          <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [`₹${v.toLocaleString()}`, 'P&L']} />
                          <ReferenceLine y={0} stroke="rgba(255,255,255,0.3)" />
                          <Bar dataKey="pnl" name="P&L" radius={[3, 3, 0, 0]}>
                            {analyticsData.byMonth.map((m: any, i: number) => <Cell key={i} fill={m.pnl >= 0 ? '#10b981' : '#ef4444'} fillOpacity={0.7} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent></Card>
                )}

                <Card className="border-border"><CardContent className="p-4">
                  <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><PieIcon className="h-4 w-4" /> P&L Distribution</h3>
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analyticsData.pnlDistribution} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis type="number" tick={{ fontSize: 10, fill: '#71717a' }} />
                        <YAxis dataKey="range" type="category" tick={{ fontSize: 10, fill: '#71717a' }} width={80} />
                        <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                        <Bar dataKey="count" name="Trades" radius={[0, 3, 3, 0]}>
                          {analyticsData.pnlDistribution.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.7} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent></Card>

                {analyticsData.trades.length > 1 && (
                  <Card className="border-border lg:col-span-2"><CardContent className="p-4">
                    <h3 className="text-sm font-semibold mb-4">Cumulative P&L</h3>
                    <div className="h-52">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={(() => { let cum = 0; return analyticsData.trades.map((t: any, i: number) => { cum += t.pnl; return { idx: i + 1, cumPnL: Math.round(cum), pnl: Math.round(t.pnl) }; }); })()}>
                          <defs><linearGradient id="cumGrad2" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={analyticsData.totalPnL >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0.3} />
                            <stop offset="95%" stopColor="transparent" stopOpacity={0} />
                          </linearGradient></defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                          <XAxis dataKey="idx" tick={{ fontSize: 10, fill: '#71717a' }} />
                          <YAxis tick={{ fontSize: 10, fill: '#71717a' }} />
                          <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                          <ReferenceLine y={0} stroke="rgba(255,255,255,0.3)" />
                          <Area type="monotone" dataKey="cumPnL" stroke={analyticsData.totalPnL >= 0 ? '#10b981' : '#ef4444'} fill="url(#cumGrad2)" strokeWidth={2} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent></Card>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-16 text-muted-foreground">
              <LineChart className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">Close some trades to see analytics.</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="risk"><Card className="border-border"><CardContent className="p-4"><RiskMetricsCard /></CardContent></Card></TabsContent>
        <TabsContent value="rmultiple"><Card className="border-border"><CardContent className="p-4"><RMultipleDistribution /></CardContent></Card></TabsContent>
        <TabsContent value="equity"><Card className="border-border"><CardContent className="p-4"><EquityCurveCard /></CardContent></Card></TabsContent>
        <TabsContent value="benchmark"><Card className="border-border"><CardContent className="p-4"><BenchmarkChart /></CardContent></Card></TabsContent>
        <TabsContent value="alerts"><Card className="border-border"><CardContent className="p-4"><AlertsPanel /></CardContent></Card></TabsContent>
        <TabsContent value="tax"><Card className="border-border"><CardContent className="p-4"><CapitalGainsReport /></CardContent></Card></TabsContent>
        <TabsContent value="rebalance"><Card className="border-border"><CardContent className="p-4"><RebalancePanel /></CardContent></Card></TabsContent>
        <TabsContent value="sip"><Card className="border-border"><CardContent className="p-4"><SIPTracker /></CardContent></Card></TabsContent>
        <TabsContent value="dividends"><Card className="border-border"><CardContent className="p-4"><DividendTracker /></CardContent></Card></TabsContent>
      </Tabs>
    </div>
  );
}