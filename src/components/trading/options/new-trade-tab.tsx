'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Shield, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SYMBOLS } from './constants';
import { fetchSafe, safeJson, fmt } from './helpers';

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
        if (data.lotSize) setLotSize(data.lotSize);
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
        if (p.lotSize) setLotSize(p.lotSize);
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

export { NewTradeTab };