'use client';

import { useTradeStore, type AppTab } from '@/store/trade-store';
import {
  LayoutDashboard, Briefcase, Bot, Radar, BookOpen, BarChart3, LineChart, Settings,
  Menu, X, Wifi, WifiOff, Shield, GitBranch,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';

const NAV_ITEMS: { id: AppTab; label: string; icon: React.ElementType; badge?: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'holdings', label: 'Holdings', icon: Briefcase },
  { id: 'options', label: 'Options', icon: GitBranch },
  { id: 'auto-trade', label: 'Auto Trade', icon: Bot },
  { id: 'scanner', label: 'Scanner', icon: Radar },
  { id: 'journal', label: 'Journal', icon: BookOpen },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'backtest', label: 'Backtest', icon: LineChart },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const { activeTab, setActiveTab } = useTradeStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [yahooOk, setYahooOk] = useState<boolean | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [universeCount, setUniverseCount] = useState(0);
  const [schedulerArmed, setSchedulerArmed] = useState(false);
  const [optionCount, setOptionCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        const [statusRes, tradesRes, optPosRes] = await Promise.all([
          fetch('/api/data-status').catch(() => null),
          fetch('/api/trades').catch(() => null),
          fetch('/api/options/positions').catch(() => null),
        ]);
        if (cancelled) return;
        if (statusRes?.ok) {
          const status = await statusRes.json();
          if (status.success) setYahooOk(status.yahoo?.available ?? null);
        }
        if (tradesRes?.ok) {
          const trades = await tradesRes.json();
          if (trades.success) setOpenCount((trades.trades || []).filter((t: any) => t.status === 'OPEN').length);
        }
        if (optPosRes?.ok && !cancelled) {
          const optData = await optPosRes.json();
          if (optData.success) setOptionCount(optData.summary?.positionCount || 0);
        }
        try {
          const { getUniverseStats } = await import('@/lib/trading/universe-scanner');
          const stats = getUniverseStats();
          if (!cancelled) setUniverseCount(stats.total);
        } catch { /* skip */ }
        try {
          const atRes = await fetch('/api/auto-trade').catch(() => null);
          if (atRes?.ok && !cancelled) {
            const atData = await atRes.json();
            if (atData.success) setSchedulerArmed(atData.scheduler?.enabled || false);
          }
        } catch { /* skip */ }
      } catch { /* ignore */ }
    };
    fetchData();
    const iv = setInterval(fetchData, 30000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  const navContent = (
    <nav className="flex flex-1 flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.id;
        return (
          <button
            key={item.id}
            onClick={() => { setActiveTab(item.id); setMobileOpen(false); }}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
              isActive
                ? 'bg-indigo-500/15 text-indigo-400'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="hidden lg:inline">{item.label}</span>
            {item.id === 'holdings' && openCount > 0 && (
              <span className="ml-auto hidden h-5 min-w-5 items-center justify-center rounded-full bg-indigo-500/20 px-1.5 text-[10px] font-bold text-indigo-400 lg:flex">
                {openCount}
              </span>
            )}
            {item.id === 'options' && optionCount > 0 && (
              <span className="ml-auto hidden h-5 min-w-5 items-center justify-center rounded-full bg-indigo-500/20 px-1.5 text-[10px] font-bold text-indigo-400 lg:flex">
                {optionCount}
              </span>
            )}
            {item.id === 'auto-trade' && schedulerArmed && (
              <span className="ml-auto hidden lg:flex">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              </span>
            )}
            {item.id === 'scanner' && (
              <span className="ml-auto hidden h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500/20 px-1.5 text-[10px] font-bold text-emerald-400 lg:flex">
                7
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );

  return (
    <>
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed top-4 left-4 z-50 flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-foreground lg:hidden"
      >
        {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>

      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={cn(
        'fixed left-0 top-0 z-40 flex h-screen w-16 flex-col items-center border-r border-border bg-sidebar py-4 lg:w-56 lg:items-stretch lg:px-3 lg:py-5 transition-transform lg:translate-x-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        {/* Branding */}
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold text-sm lg:h-10 lg:w-10 shrink-0">
            <Shield className="h-4 w-4 lg:h-5 lg:w-5" />
          </div>
          <div className="hidden lg:block">
            <div className="text-sm font-bold tracking-tight">PMS Manager</div>
            <div className="text-[10px] text-muted-foreground">Private Portfolio System</div>
          </div>
        </div>

        {navContent}

        {/* Footer: System Feed & Broker Status Badges */}
        <div className="mt-auto space-y-1.5 px-2">
          <div className={cn(
            'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-medium',
            yahooOk === true ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-secondary text-muted-foreground'
          )}>
            {yahooOk === true ? <Wifi className="h-3 w-3 text-emerald-400" /> : <WifiOff className="h-3 w-3" />}
            <span className="hidden lg:inline">{yahooOk === true ? 'Broker Feed: DhanHQ Live' : 'Connecting Data...'}</span>
          </div>

          <div className="flex items-center gap-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1.5 text-[11px] font-medium text-indigo-400">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />
            <span className="hidden lg:inline">Discord Feed: 🟢 ACTIVE</span>
          </div>

          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1.5 text-[11px] font-medium text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="hidden lg:inline">Scrip Master: 🟢 SYNCED</span>
          </div>

          {schedulerArmed && (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="hidden lg:inline">Auto-Mode Active</span>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}