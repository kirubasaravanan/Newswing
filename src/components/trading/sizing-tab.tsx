'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Calculator, Target, Shield, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SizingTab() {
  const [capital, setCapital] = useState(200000);
  const [riskPct, setRiskPct] = useState(1.0);
  const [entryPrice, setEntryPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [maxSlots, setMaxSlots] = useState(8);
  const [drawdownPct, setDrawdownPct] = useState(0);

  const entry = parseFloat(entryPrice) || 0;
  const sl = parseFloat(stopLoss) || 0;
  const tp = parseFloat(targetPrice) || 0;
  const riskPerShare = entry > 0 && sl > 0 ? entry - sl : 0;
  const rewardPerShare = tp > 0 && entry > 0 ? tp - entry : 0;
  const rr = riskPerShare > 0 ? rewardPerShare / riskPerShare : 0;

  // DD penalty
  const ddPenalty = Math.max(0.25, Math.min(1.0, 1.0 - (drawdownPct / 20)));

  // Risk amounts
  const riskAmt = capital * (riskPct / 100) * ddPenalty;
  const riskAmtHalf = capital * ((riskPct * 0.5) / 100) * ddPenalty;

  // Quantities
  const qtyByRisk = riskPerShare > 0 ? Math.floor(riskAmt / riskPerShare) : 0;
  const qtyByCap = entry > 0 ? Math.floor((capital / maxSlots) / entry) : 0;
  const qtyByRiskHalf = riskPerShare > 0 ? Math.floor(riskAmtHalf / riskPerShare) : 0;
  const qtyByCapHalf = entry > 0 ? Math.floor(((capital / maxSlots) * 0.6) / entry) : 0;

  const qtyFull = Math.min(qtyByRisk, qtyByCap);
  const qtyHalf = Math.min(qtyByRiskHalf, qtyByCapHalf);

  // Position values
  const posValueFull = qtyFull * entry;
  const posValueHalf = qtyHalf * entry;
  const slValueFull = Math.abs(entry - sl) * qtyFull;
  const slValueHalf = Math.abs(entry - sl) * qtyHalf;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold flex items-center gap-2">
        <Calculator className="h-5 w-5 text-primary" />
        Position Sizing Calculator
      </h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Input Panel */}
        <Card className="border-border">
          <CardContent className="p-5 space-y-5">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Account Capital (INR)</Label>
              <Input
                type="number"
                value={capital}
                onChange={e => setCapital(parseFloat(e.target.value) || 0)}
                className="h-10 text-lg font-mono font-bold"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Max Risk Per Trade: {riskPct}%
              </Label>
              <Slider
                value={[riskPct]}
                onValueChange={([v]) => setRiskPct(v)}
                min={0.25}
                max={5}
                step={0.25}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>Conservative (0.25%)</span>
                <span>Aggressive (5%)</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Target Portfolio Slots: {maxSlots}</Label>
              <Slider
                value={[maxSlots]}
                onValueChange={([v]) => setMaxSlots(v)}
                min={1}
                max={15}
                step={1}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Current Drawdown: {drawdownPct}%
              </Label>
              <Slider
                value={[drawdownPct]}
                onValueChange={([v]) => setDrawdownPct(v)}
                min={0}
                max={25}
                step={0.5}
              />
            </div>

            <Separator />

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Entry Price</Label>
              <Input
                type="number"
                value={entryPrice}
                onChange={e => setEntryPrice(e.target.value)}
                placeholder="e.g. 2950"
                className="h-10 text-lg font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-red-400">Stop Loss</Label>
                <Input
                  type="number"
                  value={stopLoss}
                  onChange={e => setStopLoss(e.target.value)}
                  placeholder="e.g. 2850"
                  className="h-10 font-mono border-red-500/30 focus-visible:ring-red-500/30"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-emerald-400">Target Price</Label>
                <Input
                  type="number"
                  value={targetPrice}
                  onChange={e => setTargetPrice(e.target.value)}
                  placeholder="e.g. 3100"
                  className="h-10 font-mono border-emerald-500/30 focus-visible:ring-emerald-500/30"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results Panel */}
        <div className="space-y-4">
          {/* DD Penalty */}
          <Card className="border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Drawdown Risk Penalty</span>
                </div>
                <span className={cn(
                  'text-lg font-mono font-bold',
                  ddPenalty < 0.5 ? 'text-red-400' : ddPenalty < 0.75 ? 'text-amber-400' : 'text-emerald-400'
                )}>
                  x{ddPenalty.toFixed(2)}
                </span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', ddPenalty < 0.5 ? 'bg-red-500' : ddPenalty < 0.75 ? 'bg-amber-500' : 'bg-emerald-500')}
                  style={{ width: `${ddPenalty * 100}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5">
                {drawdownPct > 15
                  ? 'Heavy drawdown — risk reduced significantly. Consider stopping trading.'
                  : drawdownPct > 10
                  ? 'Moderate drawdown — position sizes reduced.'
                  : drawdownPct > 5
                  ? 'Mild drawdown — slight risk reduction applied.'
                  : 'No drawdown — full risk allocation available.'}
              </p>
            </CardContent>
          </Card>

          {/* Risk/Reward */}
          {riskPerShare > 0 && (
            <Card className="border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Target className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Risk / Reward</span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <div className="text-[10px] text-red-400 uppercase">Risk</div>
                    <div className="text-lg font-mono font-bold text-red-400">₹{riskPerShare.toFixed(0)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase">R:R</div>
                    <div className={cn('text-lg font-mono font-bold', rr >= 2 ? 'text-emerald-400' : rr >= 1.5 ? 'text-amber-400' : 'text-red-400')}>
                      1:{rr.toFixed(1)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-emerald-400 uppercase">Reward</div>
                    <div className="text-lg font-mono font-bold text-emerald-400">₹{rewardPerShare.toFixed(0)}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Sizing Results */}
          <Card className={cn(
            'border',
            qtyFull > 0 ? 'border-emerald-500/20' : 'border-border'
          )}>
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Suggested Position Size</span>
              </div>

              {/* A+ Setup */}
              <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/10 p-4">
                <div className="flex items-center justify-between mb-3">
                  <Badge className="bg-emerald-500/20 text-emerald-400 border-0">A+ Setup (Full Risk)</Badge>
                  <span className="text-xs text-muted-foreground">₹{riskAmt.toFixed(0)} risk budget</span>
                </div>
                <div className="text-3xl font-mono font-bold text-emerald-400 mb-2">{qtyFull} shares</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded bg-secondary/50 px-3 py-2">
                    <span className="text-muted-foreground">Position Value</span>
                    <div className="font-mono font-semibold">₹{Math.round(posValueFull).toLocaleString()}</div>
                  </div>
                  <div className="rounded bg-secondary/50 px-3 py-2">
                    <span className="text-muted-foreground">Max Loss</span>
                    <div className="font-mono font-semibold text-red-400">₹{Math.round(slValueFull).toLocaleString()}</div>
                  </div>
                </div>
              </div>

              {/* B Setup */}
              <div className="rounded-lg bg-amber-500/5 border border-amber-500/10 p-4">
                <div className="flex items-center justify-between mb-3">
                  <Badge className="bg-amber-500/20 text-amber-400 border-0">B Setup (Half Risk)</Badge>
                  <span className="text-xs text-muted-foreground">₹{riskAmtHalf.toFixed(0)} risk budget</span>
                </div>
                <div className="text-3xl font-mono font-bold text-amber-400 mb-2">{qtyHalf} shares</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded bg-secondary/50 px-3 py-2">
                    <span className="text-muted-foreground">Position Value</span>
                    <div className="font-mono font-semibold">₹{Math.round(posValueHalf).toLocaleString()}</div>
                  </div>
                  <div className="rounded bg-secondary/50 px-3 py-2">
                    <span className="text-muted-foreground">Max Loss</span>
                    <div className="font-mono font-semibold text-red-400">₹{Math.round(slValueHalf).toLocaleString()}</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}