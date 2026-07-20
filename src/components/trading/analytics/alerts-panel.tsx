'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Bell, Plus, X, Target, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

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

export default AlertsPanel;