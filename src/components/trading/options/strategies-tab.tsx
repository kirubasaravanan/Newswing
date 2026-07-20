'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Zap, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SYMBOLS, STRATEGY_TEMPLATES } from './constants';
import { fetchSafe, safeJson } from './helpers';
import type { Strategy } from './types';

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

export { StrategiesTab };