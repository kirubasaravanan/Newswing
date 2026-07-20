'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Wallet, Skull } from 'lucide-react';
import type { WalletData, PositionRules, DrawdownData } from './types';

interface WalletPanelProps {
  wallet: WalletData | null;
  rules: PositionRules;
  drawdown: DrawdownData | null;
  editingWallet: boolean;
  walletInput: string;
  onEditClick: () => void;
  onWalletInputChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function WalletPanel({
  wallet, rules, drawdown, editingWallet, walletInput,
  onEditClick, onWalletInputChange, onSave, onCancel,
}: WalletPanelProps) {
  const totalPnl = (wallet?.realizedPnl || 0) + (wallet?.unrealizedPnl || 0);
  const pnlPct = wallet?.initialCapital ? (totalPnl / wallet.initialCapital) * 100 : 0;

  return (
    <Card className="lg:col-span-2 border-border">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" /> Capital Wallet
          </h3>
          {!editingWallet ? (
            <Button variant="ghost" size="sm" onClick={onEditClick} className="h-7 text-xs">Edit</Button>
          ) : (
            <div className="flex items-center gap-2">
              <Input value={walletInput} onChange={e => onWalletInputChange(e.target.value)} className="h-7 w-32 text-xs" />
              <Button size="sm" onClick={onSave} className="h-7 text-xs">Save</Button>
              <Button size="sm" variant="ghost" onClick={onCancel} className="h-7 text-xs">Cancel</Button>
            </div>
          )}
        </div>
        {wallet && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="rounded-lg bg-secondary/50 p-3">
              <div className="text-[10px] text-muted-foreground uppercase">Total Capital</div>
              <div className="text-lg font-bold font-mono mt-0.5">₹{wallet.totalCapital.toLocaleString()}</div>
            </div>
            <div className="rounded-lg bg-blue-500/10 p-3">
              <div className="text-[10px] text-blue-400 uppercase">Deployed</div>
              <div className="text-lg font-bold font-mono mt-0.5 text-blue-400">₹{wallet.deployed.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">{wallet.totalCapital > 0 ? ((wallet.deployed / wallet.totalCapital) * 100).toFixed(1) : 0}%</div>
            </div>
            <div className="rounded-lg bg-emerald-500/10 p-3">
              <div className="text-[10px] text-emerald-400 uppercase">Available</div>
              <div className="text-lg font-bold font-mono mt-0.5 text-emerald-400">₹{wallet.available.toLocaleString()}</div>
            </div>
            <div className={cn('rounded-lg p-3', totalPnl >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10')}>
              <div className={cn('text-[10px] uppercase', totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>Total P&L</div>
              <div className={cn('text-lg font-bold font-mono mt-0.5', totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                {totalPnl >= 0 ? '+' : ''}₹{totalPnl.toLocaleString()}
              </div>
              <div className="text-[10px] text-muted-foreground">R: {wallet.realizedPnl.toLocaleString()} | U: {wallet.unrealizedPnl.toLocaleString()}</div>
            </div>
            {/* v2: Drawdown Card */}
            <div className={cn('rounded-lg p-3', (drawdown?.drawdownPct || 0) >= rules.maxDrawdownPct * 0.7 ? 'bg-red-500/10' : 'bg-orange-500/10')}>
              <div className="text-[10px] text-orange-400 uppercase flex items-center gap-1">
                <Skull className="h-3 w-3" /> Drawdown
              </div>
              <div className={cn('text-lg font-bold font-mono mt-0.5',
                (drawdown?.drawdownPct || 0) >= rules.maxDrawdownPct ? 'text-red-400' : 'text-orange-400'
              )}>
                {(drawdown?.drawdownPct || 0).toFixed(2)}%
              </div>
              <div className="text-[10px] text-muted-foreground">Limit: {rules.maxDrawdownPct}%</div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}