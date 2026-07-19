'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  TrendingUp, TrendingDown, RefreshCw, ArrowRight, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SYMBOLS } from './constants';
import { fetchSafe, fmt } from './helpers';
import type { ChainData } from './types';

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

export { OptionChainTab };