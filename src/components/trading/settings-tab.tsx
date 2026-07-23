'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Briefcase, Plus, Trash2, Wallet, RefreshCw, FolderPlus, IndianRupee,
  TrendingUp, Calendar, PieChart, Shield,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getUniverseStats } from '@/lib/trading/universe-scanner';

// ── Portfolio Manager ──────────────────────────────────
function PortfolioManager() {
  const [portfolios, setPortfolios] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', totalCapital: '200000' });

  const fetchPortfolios = useCallback(async () => {
    try {
      const res = await fetch('/api/portfolios');
      const data = await res.json();
      if (data.success) setPortfolios(data.portfolios);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { fetchPortfolios(); }, [fetchPortfolios]);

  const createPortfolio = async () => {
    if (!form.name) return;
    try {
      const res = await fetch('/api/portfolios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, description: form.description, totalCapital: parseFloat(form.totalCapital) }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Portfolio "${form.name}" created`);
        setForm({ name: '', description: '', totalCapital: '200000' });
        setOpen(false);
        fetchPortfolios();
      }
    } catch { toast.error('Failed to create portfolio'); }
  };

  const deletePortfolio = async (id: string) => {
    await fetch(`/api/portfolios?id=${id}`, { method: 'DELETE' });
    fetchPortfolios();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Briefcase className="h-4 w-4" /> Portfolios</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" className="h-7 text-xs gap-1"><Plus className="h-3 w-3" /> New Portfolio</Button></DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle>Create Portfolio</DialogTitle></DialogHeader>
            <div className="grid gap-3 py-2">
              <div><Label className="text-xs">Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Aggressive Growth" className="h-8 text-xs" /></div>
              <div><Label className="text-xs">Description</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="High risk, high reward" className="h-8 text-xs" /></div>
              <div><Label className="text-xs">Capital (₹)</Label><Input type="number" value={form.totalCapital} onChange={e => setForm({ ...form, totalCapital: e.target.value })} className="h-8 text-xs" /></div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="ghost" size="sm">Cancel</Button></DialogClose>
              <Button size="sm" onClick={createPortfolio}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {portfolios.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-6">No portfolios. Create one to organize your trades.</p>
      ) : (
        <div className="grid gap-2">
          {portfolios.map(p => (
            <div key={p.id} className="flex items-center gap-3 rounded-lg bg-secondary/50 p-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400 text-xs font-bold">
                {p.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{p.name}</div>
                <div className="text-[10px] text-muted-foreground">
                  ₹{Math.round(p.totalCapital).toLocaleString()} &middot; {p.openPositions || 0} open
                  {p.description && ` · ${p.description}`}
                </div>
              </div>
              {p.isDefault && <Badge variant="outline" className="text-[9px] h-4 text-indigo-400">DEFAULT</Badge>}
              <button onClick={() => deletePortfolio(p.id)} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── SIP Plans Manager ──────────────────────────────────
function SIPPanel() {
  const [data, setData] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ symbol: '', amount: '5000', frequency: 'MONTHLY', nextDate: '', stockName: '' });

  const fetchSIPs = useCallback(async () => {
    try {
      const res = await fetch('/api/portfolio/sip');
      const d = await res.json();
      if (d.success) setData(d);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { fetchSIPs(); }, [fetchSIPs]);

  const createSIP = async () => {
    if (!form.symbol || !form.amount || !form.nextDate) return;
    try {
      const res = await fetch('/api/portfolio/sip', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (d.success) {
        toast.success(`SIP created: ${form.symbol} ₹${form.amount}`);
        setForm({ symbol: '', amount: '5000', frequency: 'MONTHLY', nextDate: '', stockName: '' });
        setOpen(false);
        fetchSIPs();
      }
    } catch { toast.error('Failed to create SIP'); }
  };

  const deleteSIP = async (id: string) => {
    await fetch(`/api/portfolio/sip?id=${id}`, { method: 'DELETE' });
    fetchSIPs();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Calendar className="h-4 w-4" /> SIP Plans</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" className="h-7 text-xs gap-1"><Plus className="h-3 w-3" /> New SIP</Button></DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle>Create SIP Plan</DialogTitle></DialogHeader>
            <div className="grid gap-3 py-2">
              <div><Label className="text-xs">Symbol</Label><Input value={form.symbol} onChange={e => setForm({ ...form, symbol: e.target.value.toUpperCase() })} placeholder="HDFCBANK" className="h-8 text-xs" /></div>
              <div><Label className="text-xs">Amount (₹)</Label><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="h-8 text-xs" /></div>
              <div><Label className="text-xs">Frequency</Label>
                <Select value={form.frequency} onValueChange={v => setForm({ ...form, frequency: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WEEKLY">Weekly</SelectItem>
                    <SelectItem value="MONTHLY">Monthly</SelectItem>
                    <SelectItem value="QUARTERLY">Quarterly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Next Installment Date</Label><Input type="date" value={form.nextDate} onChange={e => setForm({ ...form, nextDate: e.target.value })} className="h-8 text-xs" /></div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="ghost" size="sm">Cancel</Button></DialogClose>
              <Button size="sm" onClick={createSIP}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {data && (
        <div className="grid grid-cols-2 gap-3 mb-3">
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
      )}

      {(!data || data.plans.length === 0) ? (
        <p className="text-xs text-muted-foreground text-center py-4">No active SIP plans.</p>
      ) : (
        <ScrollArea className="max-h-[250px]">
          <div className="space-y-1.5 pr-2">
            {data.plans.map((p: any) => (
              <div key={p.id} className="flex items-center gap-2 text-xs py-2 border-b border-border/30">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold">{p.symbol}</div>
                  <div className="text-[10px] text-muted-foreground">
                    ₹{p.amount.toLocaleString()} · {p.frequency} · {p.installmentsCompleted} done
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-mono text-emerald-400">{p.returnPct >= 0 ? '+' : ''}{p.returnPct.toFixed(1)}%</div>
                  <div className="text-[10px] text-muted-foreground">Next: {new Date(p.nextDate).toLocaleDateString()}</div>
                </div>
                <button onClick={() => deleteSIP(p.id)} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// ── Watchlist Folders ──────────────────────────────────
function WatchlistFolders() {
  const [folders, setFolders] = useState<any[]>([]);
  const [ungrouped, setUngrouped] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', color: '#6366f1' });

  const fetchFolders = useCallback(async () => {
    try {
      const res = await fetch('/api/watchlist/folders');
      const data = await res.json();
      if (data.success) { setFolders(data.folders || []); setUngrouped(data.ungrouped || []); }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { fetchFolders(); }, [fetchFolders]);

  const createFolder = async () => {
    if (!form.name) return;
    try {
      const res = await fetch('/api/watchlist/folders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if ((await res.json()).success) {
        toast.success(`Folder "${form.name}" created`);
        setForm({ name: '', color: '#6366f1' });
        setOpen(false);
        fetchFolders();
      }
    } catch { toast.error('Failed to create folder'); }
  };

  const deleteFolder = async (id: string) => {
    await fetch(`/api/watchlist/folders?id=${id}`, { method: 'DELETE' });
    fetchFolders();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2"><FolderPlus className="h-4 w-4" /> Watchlist Folders</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" className="h-7 text-xs gap-1"><Plus className="h-3 w-3" /> New Folder</Button></DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle>Create Folder</DialogTitle></DialogHeader>
            <div className="grid gap-3 py-2">
              <div><Label className="text-xs">Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Banking Stocks" className="h-8 text-xs" /></div>
              <div><Label className="text-xs">Color</Label><Input type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} className="h-8 w-16" /></div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="ghost" size="sm">Cancel</Button></DialogClose>
              <Button size="sm" onClick={createFolder}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {folders.length === 0 && ungrouped.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">No folders. Organize your watchlist by creating folders.</p>
      ) : (
        <ScrollArea className="max-h-[300px]">
          <div className="space-y-2 pr-2">
            {folders.map((f: any) => (
              <div key={f.id} className="rounded-lg bg-secondary/30 p-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full" style={{ background: f.color }} />
                    <span className="text-xs font-semibold">{f.name}</span>
                    <Badge variant="outline" className="text-[9px] h-4">{f.stocks?.length || 0}</Badge>
                  </div>
                  <button onClick={() => deleteFolder(f.id)} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {f.stocks?.map((s: any) => (
                    <Badge key={s.symbol} variant="secondary" className="text-[10px] h-5">{s.symbol}</Badge>
                  ))}
                </div>
              </div>
            ))}
            {ungrouped.length > 0 && (
              <div className="rounded-lg bg-secondary/30 p-2.5">
                <div className="text-[10px] text-muted-foreground mb-1.5">Ungrouped ({ungrouped.length})</div>
                <div className="flex flex-wrap gap-1">
                  {ungrouped.slice(0, 20).map((s: any) => (
                    <Badge key={s.symbol} variant="outline" className="text-[10px] h-5">{s.symbol}</Badge>
                  ))}
                  {ungrouped.length > 20 && <span className="text-[10px] text-muted-foreground">+{ungrouped.length - 20} more</span>}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// ── Capital & Config ───────────────────────────────────
function CapitalConfig() {
  const [wallet, setWallet] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [capital, setCapital] = useState('200000');

  const fetchWallet = useCallback(async () => {
    try {
      const res = await fetch('/api/portfolio/summary');
      const data = await res.json();
      if (data.success && data.summary?.wallet) {
        setWallet(data.summary.wallet);
        setCapital(String(data.summary.wallet.totalCapital));
      }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { fetchWallet(); }, [fetchWallet]);

  const updateCapital = async () => {
    try {
      const res = await fetch('/api/portfolio/summary', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ totalCapital: parseFloat(capital) }),
      });
      if (res.ok) { toast.success('Capital updated'); setEditing(false); fetchWallet(); }
    } catch { toast.error('Failed to update capital'); }
  };

  if (!wallet) return <p className="text-xs text-muted-foreground text-center py-4">Loading...</p>;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-2"><Wallet className="h-4 w-4" /> Capital Configuration</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Total Capital</div>
          {editing ? (
            <div className="flex gap-1 mt-1">
              <Input type="number" value={capital} onChange={e => setCapital(e.target.value)} className="h-7 text-xs" />
              <Button size="sm" className="h-7 text-xs" onClick={updateCapital}>Save</Button>
            </div>
          ) : (
            <div className="flex items-center gap-1 mt-1">
              <span className="text-lg font-bold font-mono">₹{Math.round(wallet.totalCapital).toLocaleString()}</span>
              <button onClick={() => setEditing(true)} className="text-muted-foreground hover:text-foreground"><RefreshCw className="h-3 w-3" /></button>
            </div>
          )}
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Available Cash</div>
          <div className="text-lg font-bold font-mono text-emerald-400">₹{Math.round(wallet.available).toLocaleString()}</div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Deployed</div>
          <div className="text-lg font-bold font-mono">₹{Math.round(wallet.deployed).toLocaleString()}</div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Realized P&L</div>
          <div className={cn('text-lg font-bold font-mono', wallet.realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {wallet.realizedPnl >= 0 ? '+' : ''}₹{Math.round(wallet.realizedPnl).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Universe Stats ─────────────────────────────────────
function UniverseStatsCard() {
  const [stats, setStats] = useState<any>(null);
  useEffect(() => {
    const s = getUniverseStats();
    setStats(s);
  }, []);

  if (!stats) return null;
  const topSectors = Object.entries(stats.bySector).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 8);

  return (
    <div>
      <h3 className="text-sm font-semibold flex items-center gap-2 mb-3"><PieChart className="h-4 w-4" /> Scan Universe</h3>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="rounded-lg bg-indigo-500/10 p-3 text-center">
          <div className="text-[10px] text-indigo-400 uppercase">Total Stocks</div>
          <div className="text-2xl font-bold font-mono text-indigo-400">{stats.total}</div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3 text-center">
          <div className="text-[10px] text-muted-foreground uppercase">Categories</div>
          <div className="text-2xl font-bold font-mono">{Object.keys(stats.byCategory).length}</div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3 text-center">
          <div className="text-[10px] text-muted-foreground uppercase">Sectors</div>
          <div className="text-2xl font-bold font-mono">{Object.keys(stats.bySector).length}</div>
        </div>
      </div>
      <h4 className="text-xs font-semibold mb-2">By Category</h4>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {Object.entries(stats.byCategory).map(([cat, count]) => (
          <Badge key={cat} variant="outline" className="text-[10px] h-5">{cat}: {String(count)}</Badge>
        ))}
      </div>
      <h4 className="text-xs font-semibold mb-2">Top Sectors</h4>
      <div className="flex flex-wrap gap-1.5">
        {topSectors.map(([sector, count]) => (
          <Badge key={sector} variant="secondary" className="text-[10px] h-5">{sector} ({String(count)})</Badge>
        ))}
      </div>
    </div>
  );
}

// ── Dividend Tracker ───────────────────────────────────
function DividendPanel() {
  const [data, setData] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ symbol: '', exDate: '', dividendPerShare: '', qty: '1', stockName: '' });

  const fetchDividends = useCallback(async () => {
    try {
      const res = await fetch('/api/portfolio/dividends');
      const d = await res.json();
      if (d.success) setData(d);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { fetchDividends(); }, [fetchDividends]);

  const addDividend = async () => {
    if (!form.symbol || !form.exDate || !form.dividendPerShare) return;
    try {
      const dps = parseFloat(form.dividendPerShare);
      const qty = parseInt(form.qty) || 1;
      const res = await fetch('/api/portfolio/dividends', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, totalAmount: dps * qty }),
      });
      if ((await res.json()).success) {
        toast.success(`Dividend recorded: ${form.symbol}`);
        setForm({ symbol: '', exDate: '', dividendPerShare: '', qty: '1', stockName: '' });
        setOpen(false);
        fetchDividends();
      }
    } catch { toast.error('Failed to record dividend'); }
  };

  const deleteDiv = async (id: string) => {
    await fetch(`/api/portfolio/dividends?id=${id}`, { method: 'DELETE' });
    fetchDividends();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2"><IndianRupee className="h-4 w-4" /> Dividend Tracker</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" className="h-7 text-xs gap-1"><Plus className="h-3 w-3" /> Record Dividend</Button></DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle>Record Dividend</DialogTitle></DialogHeader>
            <div className="grid gap-3 py-2">
              <div><Label className="text-xs">Symbol</Label><Input value={form.symbol} onChange={e => setForm({ ...form, symbol: e.target.value.toUpperCase() })} placeholder="ITC" className="h-8 text-xs" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Ex-Date</Label><Input type="date" value={form.exDate} onChange={e => setForm({ ...form, exDate: e.target.value })} className="h-8 text-xs" /></div>
                <div><Label className="text-xs">DPS (₹)</Label><Input type="number" step="0.01" value={form.dividendPerShare} onChange={e => setForm({ ...form, dividendPerShare: e.target.value })} placeholder="6.75" className="h-8 text-xs" /></div>
              </div>
              <div><Label className="text-xs">Qty Held</Label><Input type="number" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} className="h-8 text-xs" /></div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="ghost" size="sm">Cancel</Button></DialogClose>
              <Button size="sm" onClick={addDividend}>Record</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {data?.summary && data.summary.totalDividends > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="rounded-lg bg-emerald-500/10 p-3">
            <div className="text-[10px] text-emerald-400 uppercase">Total Dividends</div>
            <div className="text-lg font-bold font-mono text-emerald-400">₹{data.summary.totalDividends.toLocaleString()}</div>
          </div>
          <div className="rounded-lg bg-secondary/50 p-3">
            <div className="text-[10px] text-muted-foreground uppercase">Stocks</div>
            <div className="text-lg font-bold font-mono">{data.summary.uniqueStocks}</div>
          </div>
        </div>
      )}

      {(!data || data.dividends.length === 0) ? (
        <p className="text-xs text-muted-foreground text-center py-4">No dividends recorded yet.</p>
      ) : (
        <ScrollArea className="max-h-[220px]">
          <div className="space-y-1.5 pr-2">
            {data.dividends.slice(0, 20).map((d: any) => (
              <div key={d.id} className="flex items-center gap-2 text-xs py-1.5 border-b border-border/30">
                <span className="font-semibold shrink-0">{d.symbol}</span>
                <Badge variant="outline" className="text-[9px] h-4 text-emerald-400">₹{d.dividendPerShare}/share</Badge>
                <span className="font-mono text-emerald-400">₹{Math.round(d.totalAmount).toLocaleString()}</span>
                <span className="text-muted-foreground ml-auto">{new Date(d.exDate).toLocaleDateString()}</span>
                <button onClick={() => deleteDiv(d.id)} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// ── Main Settings Tab ──────────────────────────────────
export function SettingsTab() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2"><Shield className="h-5 w-5 text-indigo-400" /> Settings</h2>
      </div>

      <Tabs defaultValue="capital" className="w-full">
        <TabsList className="w-full justify-start mb-4">
          <TabsTrigger value="capital" className="text-xs">Capital</TabsTrigger>
          <TabsTrigger value="portfolios" className="text-xs">Portfolios</TabsTrigger>
          <TabsTrigger value="sip" className="text-xs">SIP Plans</TabsTrigger>
          <TabsTrigger value="dividends" className="text-xs">Dividends</TabsTrigger>
          <TabsTrigger value="folders" className="text-xs">Watchlist Folders</TabsTrigger>
          <TabsTrigger value="universe" className="text-xs">Universe</TabsTrigger>
        </TabsList>

        <TabsContent value="capital"><Card className="border-border"><CardContent className="p-4"><CapitalConfig /></CardContent></Card></TabsContent>
        <TabsContent value="portfolios"><Card className="border-border"><CardContent className="p-4"><PortfolioManager /></CardContent></Card></TabsContent>
        <TabsContent value="sip"><Card className="border-border"><CardContent className="p-4"><SIPPanel /></CardContent></Card></TabsContent>
        <TabsContent value="dividends"><Card className="border-border"><CardContent className="p-4"><DividendPanel /></CardContent></Card></TabsContent>
        <TabsContent value="folders"><Card className="border-border"><CardContent className="p-4"><WatchlistFolders /></CardContent></Card></TabsContent>
        <TabsContent value="universe"><Card className="border-border"><CardContent className="p-4"><UniverseStatsCard /></CardContent></Card></TabsContent>
      </Tabs>
    </div>
  );
}