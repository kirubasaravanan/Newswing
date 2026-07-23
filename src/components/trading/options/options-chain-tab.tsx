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
import { Badge } from '@/components/ui/badge';
import {
  TrendingUp, TrendingDown, RefreshCw, ArrowRight, Clock,
  Radio, Calculator, Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SYMBOLS } from './constants';
import { fetchSafe, fmt } from './helpers';
import type { ChainData } from './types';

interface OptionChainTabProps {
  selectedSymbol?: string;
  onSymbolChange?: (symbol: string) => void;
}

function formatOI(oi: number): string {
  if (!oi || oi === 0) return '0';
  if (oi >= 1000000) return `${(oi / 1000000).toFixed(2)}M`;
  if (oi >= 1000) return `${(oi / 1000).toFixed(1)}K`;
  return oi.toLocaleString('en-IN');
}

export function OptionChainTab({ selectedSymbol, onSymbolChange }: OptionChainTabProps) {
  const [internalSymbol, setInternalSymbol] = useState('LT');
  const symbol = selectedSymbol || internalSymbol;

  const handleSymbolChange = (newSym: string) => {
    setInternalSymbol(newSym);
    setSelectedExpiry('');
    setChainData(null);
    if (onSymbolChange) onSymbolChange(newSym);
  };

  const [chainData, setChainData] = useState<ChainData | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [prefill, setPrefill] = useState<{ strike: number; type: 'CE' | 'PE'; premium: number; lotSize?: number } | null>(null);

  const fetchChain = useCallback(async (sym: string, exp?: string) => {
    setLoading(true);
    const url = `/api/options/chain?symbol=${sym}${exp ? `&expiry=${exp}` : ''}`;
    const data = await fetchSafe(url);
    console.log(`[BROWSER CONSOLE] Option Chain Table Data for ${sym}:`, data);
    if (data?.success) {
      setChainData(data);
      if (data.expiryDate) {
        setSelectedExpiry(data.expiryDate);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    setSelectedExpiry('');
    setChainData(null);
    fetchChain(symbol, '');
  }, [symbol]);

  const handleExpiryChange = (newExp: string) => {
    setSelectedExpiry(newExp);
    fetchChain(symbol, newExp);
  };

  const handleRowClick = (strike: number, type: 'CE' | 'PE', premium: number) => {
    setPrefill({ strike, type, premium, lotSize: chainData?.lotSize });
  };

  const handlePrefillTrade = () => {
    if (prefill) {
      sessionStorage.setItem('options-prefill', JSON.stringify(prefill));
      window.dispatchEvent(new CustomEvent('switch-tab', { detail: 'order-form' }));
    }
  };

  const expiryCountdown = useMemo(() => {
    if (!chainData?.expiryDate) return '—';
    const now = new Date();
    const expiry = new Date(chainData.expiryDate + 'T15:30:00+05:30');
    const days = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return days <= 0 ? 'Expiry Day' : `${days}d ${Math.max(0, 23 - now.getHours())}h`;
  }, [chainData?.expiryDate]);

  const isLive = chainData?.dataSource === 'nse_live' || chainData?.dataSource === 'dhan_live';
  const lotSize = chainData?.lotSize || 25;

  // Format per-lot price: premium × lot size
  const perLot = (premium: number) => Math.round(premium * lotSize);

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={symbol} onValueChange={handleSymbolChange}>
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
            value={selectedExpiry || chainData.expiryDate}
            onValueChange={handleExpiryChange}
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

        <Button variant="outline" size="sm" onClick={() => fetchChain(symbol, selectedExpiry)} disabled={loading} className="h-9">
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Spot Info + Data Source Indicator */}
      {chainData && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-secondary/30 px-4 py-2.5 text-sm">
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
          <div className="text-muted-foreground text-xs">
            Lot: <span className="text-foreground font-medium">{lotSize}</span>
          </div>

          {/* Data Source Badge */}
          <Badge className="ml-auto h-6 text-[10px] bg-emerald-500/20 text-emerald-400 border-emerald-500/30 gap-1">
            <Radio className="h-2.5 w-2.5" /> {chainData?.dataSource === 'dhan_live' ? 'DhanHQ Broker Live' : 'Live Broker Feed'}
          </Badge>

          {prefill && (
            <Button size="sm" onClick={handlePrefillTrade} className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700">
              <ArrowRight className="h-3 w-3 mr-1" /> Trade {prefill.strike} {prefill.type}
            </Button>
          )}
        </div>
      )}

      {/* PCR & Max Pain Summary (only for NSE live data) */}
      {isLive && chainData?.pcr && (
        <div className="flex flex-wrap gap-3 text-xs">
          <div className="rounded-md bg-secondary/30 px-3 py-1.5">
            <span className="text-muted-foreground">PCR:</span>{' '}
            <span className={cn(
              'font-semibold',
              chainData.pcr.pcr > 1.2 ? 'text-red-400' : chainData.pcr.pcr < 0.8 ? 'text-emerald-400' : 'text-foreground'
            )}>
              {chainData.pcr.pcr.toFixed(2)}
            </span>
            <span className="text-muted-foreground ml-1.5">({chainData.pcr.signal})</span>
          </div>
          {chainData.maxPain && (
            <div className="rounded-md bg-secondary/30 px-3 py-1.5">
              <span className="text-muted-foreground">Max Pain:</span>{' '}
              <span className="font-semibold text-indigo-400">{chainData.maxPain.maxPainStrike}</span>
            </div>
          )}
          <div className="rounded-md bg-secondary/30 px-3 py-1.5 flex items-center gap-1 text-muted-foreground">
            <Info className="h-3 w-3" />
            OI, Volume, IV from NSE. Greeks calculated via BSM with real IV.
          </div>
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
                  <TableHead className="text-center h-8 w-14">Chg OI</TableHead>
                  <TableHead className="text-center h-8 w-12">IV%</TableHead>
                  <TableHead className="text-center h-8 w-14">LTP(CE)</TableHead>
                  <TableHead className="text-center h-8 w-14">Per Lot</TableHead>
                  <TableHead className="text-center h-8 w-10">Δ</TableHead>
                  <TableHead className="text-center h-8 w-10">Θ</TableHead>
                  <TableHead className="text-center h-8 font-bold w-20">Strike</TableHead>
                  <TableHead className="text-center h-8 w-10">Θ</TableHead>
                  <TableHead className="text-center h-8 w-10">Δ</TableHead>
                  <TableHead className="text-center h-8 w-14">LTP(PE)</TableHead>
                  <TableHead className="text-center h-8 w-14">Per Lot</TableHead>
                  <TableHead className="text-center h-8 w-12">IV%</TableHead>
                  <TableHead className="text-center h-8 w-14">Chg OI</TableHead>
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
                      <TableCell className="text-center text-muted-foreground font-mono">{formatOI(row.ce.oi)}</TableCell>
                      {/* Change in OI */}
                      <TableCell className={cn(
                        'text-center font-mono',
                        (row.ce.changeInOI || 0) > 0 ? 'text-emerald-400' : (row.ce.changeInOI || 0) < 0 ? 'text-red-400' : 'text-muted-foreground'
                      )}>
                        {row.ce.changeInOI != null ? formatOI(row.ce.changeInOI) : '—'}
                      </TableCell>
                      <TableCell className="text-center text-amber-400">{row.ce.iv.toFixed(1)}</TableCell>
                      <TableCell
                        className="text-center font-medium text-emerald-400 cursor-pointer hover:bg-emerald-500/10"
                        onClick={(e) => { e.stopPropagation(); handleRowClick(row.strike, 'CE', row.ce.ltp); }}
                      >
                        {row.ce.ltp}
                      </TableCell>
                      {/* Per-Lot Price */}
                      <TableCell className="text-center font-medium text-emerald-300">
                        ₹{perLot(row.ce.ltp).toLocaleString('en-IN')}
                      </TableCell>
                      <TableCell className="text-center">{row.ce.delta.toFixed(2)}</TableCell>
                      <TableCell className={cn('text-center', row.ce.theta < 0 ? 'text-red-400' : 'text-emerald-400')}>
                        {row.ce.theta.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-center font-bold bg-secondary/10 text-foreground">
                        {row.strike}
                      </TableCell>
                      <TableCell className={cn('text-center', row.pe.theta < 0 ? 'text-red-400' : 'text-emerald-400')}>
                        {row.pe.theta.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-center">{row.pe.delta.toFixed(2)}</TableCell>
                      <TableCell
                        className="text-center font-medium text-red-400 cursor-pointer hover:bg-red-500/10"
                        onClick={(e) => { e.stopPropagation(); handleRowClick(row.strike, 'PE', row.pe.ltp); }}
                      >
                        {row.pe.ltp}
                      </TableCell>
                      {/* Per-Lot Price */}
                      <TableCell className="text-center font-medium text-red-300">
                        ₹{perLot(row.pe.ltp).toLocaleString('en-IN')}
                      </TableCell>
                      <TableCell className="text-center text-amber-400">{row.pe.iv.toFixed(1)}</TableCell>
                      <TableCell className={cn(
                        'text-center font-mono',
                        (row.pe.changeInOI || 0) > 0 ? 'text-emerald-400' : (row.pe.changeInOI || 0) < 0 ? 'text-red-400' : 'text-muted-foreground'
                      )}>
                        {row.pe.changeInOI != null ? formatOI(row.pe.changeInOI) : '—'}
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground font-mono">{formatOI(row.pe.oi)}</TableCell>
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