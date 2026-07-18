'use client';

import { useState } from 'react';
import { useTradeStore } from '@/store/trade-store';
import type { ScreeningConfig } from '@/lib/trading/screening-engine';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Settings, X, RotateCcw } from 'lucide-react';

export function ConfigPanel() {
  const { config, setConfig } = useTradeStore();
  const [open, setOpen] = useState(false);

  const update = (key: keyof ScreeningConfig, value: number | boolean) => {
    setConfig({ [key]: value });
  };

  const reset = () => {
    setConfig({
      liveCapital: 200000,
      riskPct: 1.0,
      maxSlots: 8,
      maxOpenTrades: 3,
      maxHoldBars: 25,
      minScore: 4,
      minRR: 1.5,
      cooldownBars: 1,
      useMacro: true,
      minTurnoverCr: 25.0,
    });
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(!open)}
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
      >
        <Settings className="h-4 w-4" />
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">Strategy Configuration</h2>
                <p className="text-xs text-muted-foreground">V-Swing v65.5 Parameters</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={reset} className="h-8 w-8">
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setOpen(false)} className="h-8 w-8">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Portfolio & Risk */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Portfolio & Risk</h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Live Capital (INR)</Label>
                  <Input
                    type="number"
                    value={config.liveCapital}
                    onChange={(e) => update('liveCapital', parseFloat(e.target.value) || 0)}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Risk Per Trade: {config.riskPct}%</Label>
                  <Slider
                    value={[config.riskPct]}
                    onValueChange={([v]) => update('riskPct', v)}
                    min={0.25}
                    max={5}
                    step={0.25}
                    className="mt-3"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Target Slots: {config.maxSlots}</Label>
                  <Slider
                    value={[config.maxSlots]}
                    onValueChange={([v]) => update('maxSlots', v)}
                    min={1}
                    max={15}
                    step={1}
                    className="mt-3"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Max Concurrent: {config.maxOpenTrades}</Label>
                  <Slider
                    value={[config.maxOpenTrades]}
                    onValueChange={([v]) => update('maxOpenTrades', v)}
                    min={1}
                    max={5}
                    step={1}
                    className="mt-3"
                  />
                </div>
              </div>

              <Separator className="my-4" />

              {/* Signal Engine */}
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Signal Engine</h3>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Min Score: {config.minScore}/6</Label>
                  <Slider
                    value={[config.minScore]}
                    onValueChange={([v]) => update('minScore', v)}
                    min={1}
                    max={6}
                    step={1}
                    className="mt-3"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Min R:R: {config.minRR}x</Label>
                  <Slider
                    value={[config.minRR]}
                    onValueChange={([v]) => update('minRR', v)}
                    min={0.5}
                    max={5}
                    step={0.1}
                    className="mt-3"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Capital Stall Limit: {config.maxHoldBars} bars</Label>
                <Slider
                  value={[config.maxHoldBars]}
                  onValueChange={([v]) => update('maxHoldBars', v)}
                  min={5}
                  max={50}
                  step={1}
                  className="mt-3"
                />
              </div>

              <Separator className="my-4" />

              {/* Regime */}
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Regime Engine</h3>
              
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs font-medium">Nifty &gt; 200 SMA Shield</Label>
                  <p className="text-[10px] text-muted-foreground">Only trade when Nifty is above 200 SMA</p>
                </div>
                <Switch
                  checked={config.useMacro}
                  onCheckedChange={(v) => update('useMacro', v)}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Min Turnover: {config.minTurnoverCr} Cr</Label>
                <Slider
                  value={[config.minTurnoverCr]}
                  onValueChange={([v]) => update('minTurnoverCr', v)}
                  min={5}
                  max={100}
                  step={5}
                  className="mt-3"
                />
              </div>
            </div>

            <Button onClick={() => setOpen(false)} className="mt-6 w-full">
              Apply Configuration
            </Button>
          </div>
        </div>
      )}
    </>
  );
}