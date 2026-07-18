'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ListPlus, Trash2, Search, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface WatchlistStock {
  id: string;
  symbol: string;
  name: string;
  sector: string | null;
  addedAt: string;
}

const SECTORS = ['Banking', 'IT', 'FMCG', 'Auto', 'Pharma', 'Metals', 'Energy', 'Telecom', 'Finance', 'Infrastructure', 'Power', 'Cement', 'Retail', 'Consumer', 'Conglomerate', 'Index', 'Other'];

export function WatchlistPanel({ stockCount }: { stockCount: number }) {
  const [stocks, setStocks] = useState<WatchlistStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [addForm, setAddForm] = useState({ symbol: '', name: '', sector: '' });
  const [searchQuery, setSearchQuery] = useState('');

  const fetchStocks = useCallback(async () => {
    try {
      const res = await fetch('/api/watchlist');
      const data = await res.json();
      if (data.success) setStocks(data.stocks);
    } catch (err) {
      console.error('Fetch watchlist error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStocks(); }, [fetchStocks]);

  const addStock = async () => {
    if (!addForm.symbol.trim()) return;
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: addForm.symbol, name: addForm.name || addForm.symbol, sector: addForm.sector || null }),
      });
      const data = await res.json();
      if (data.success && data.count > 0) {
        toast.success(`${addForm.symbol} added to watchlist`);
        setAddForm({ symbol: '', name: '', sector: '' });
        fetchStocks();
      } else {
        toast.info(`${addForm.symbol} is already in the watchlist`);
      }
    } catch {
      toast.error('Failed to add stock');
    }
  };

  const removeStock = async (symbol: string) => {
    try {
      await fetch(`/api/watchlist?symbol=${symbol}`, { method: 'DELETE' });
      toast.info(`Removed ${symbol} from watchlist`);
      fetchStocks();
    } catch {
      toast.error('Failed to remove stock');
    }
  };

  const resetWatchlist = async () => {
    try {
      // Delete all, then re-fetch (triggers re-seed on empty)
      for (const s of stocks) {
        await fetch(`/api/watchlist?symbol=${s.symbol}`, { method: 'DELETE' });
      }
      fetchStocks();
      toast.success('Watchlist reset to defaults');
    } catch {
      toast.error('Failed to reset');
    }
  };

  const filteredStocks = searchQuery
    ? stocks.filter(s => s.symbol.includes(searchQuery.toUpperCase()) || s.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : stocks;

  const sectorCounts: Record<string, number> = {};
  stocks.forEach(s => { const sec = s.sector || 'Other'; sectorCounts[sec] = (sectorCounts[sec] || 0) + 1; });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
          <ListPlus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Watchlist</span>
          <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5 text-[10px]">{stockCount}</Badge>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Watchlist Management</span>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={resetWatchlist}>
              <RefreshCw className="h-3 w-3" />
              Reset to Defaults
            </Button>
          </DialogTitle>
        </DialogHeader>

        {/* Add stock form */}
        <div className="flex gap-2">
          <Input
            value={addForm.symbol}
            onChange={e => setAddForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))}
            placeholder="SYMBOL"
            className="h-9 text-sm font-mono uppercase"
            onKeyDown={e => e.key === 'Enter' && addStock()}
          />
          <Input
            value={addForm.name}
            onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Company name"
            className="h-9 text-sm flex-1"
            onKeyDown={e => e.key === 'Enter' && addStock()}
          />
          <Select value={addForm.sector} onValueChange={v => setAddForm(f => ({ ...f, sector: v }))}>
            <SelectTrigger className="h-9 w-28 text-xs"><SelectValue placeholder="Sector" /></SelectTrigger>
            <SelectContent>
              {SECTORS.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={addStock} disabled={!addForm.symbol.trim()} size="sm" className="h-9 px-3">
            Add
          </Button>
        </div>

        {/* Search + Sector filter */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search symbols..."
              className="h-8 text-sm pl-8"
            />
          </div>
        </div>

        {/* Sector badges */}
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(sectorCounts).sort((a, b) => b[1] - a[1]).map(([sector, count]) => (
            <Badge key={sector} variant="outline" className="text-[10px] px-2 py-0.5">
              {sector} <span className="ml-1 text-muted-foreground">{count}</span>
            </Badge>
          ))}
        </div>

        {/* Stock list */}
        <ScrollArea className="max-h-[300px]">
          <div className="space-y-1 pr-4">
            {filteredStocks.map(stock => (
              <div key={stock.id} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-secondary/50 transition-colors group">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                    {stock.symbol.slice(0, 2)}
                  </div>
                  <div>
                    <div className="text-sm font-semibold font-mono">{stock.symbol}</div>
                    <div className="text-[10px] text-muted-foreground">{stock.name}{stock.sector ? ` · ${stock.sector}` : ''}</div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-300"
                  onClick={() => removeStock(stock.symbol)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="text-xs text-muted-foreground text-center">
          {filteredStocks.length} stock{filteredStocks.length !== 1 ? 's' : ''} in watchlist
        </div>
      </DialogContent>
    </Dialog>
  );
}