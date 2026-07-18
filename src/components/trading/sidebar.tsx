'use client';

import { useTradeStore, type AppTab } from '@/store/trade-store';
import {
  Radar, BookOpen, BarChart3, LineChart, Calculator,
  Menu, X, Globe, Bot,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';

const NAV_ITEMS: { id: AppTab; label: string; icon: React.ElementType; badge?: boolean }[] = [
  { id: 'screener', label: 'Screener', icon: Radar },
  { id: 'universe', label: 'Universe', icon: Globe },
  { id: 'autotrade', label: 'Auto-Trade', icon: Bot },
  { id: 'journal', label: 'Journal', icon: BookOpen },
  { id: 'backtest', label: 'Backtest', icon: BarChart3 },
  { id: 'analytics', label: 'Analytics', icon: LineChart },
  { id: 'sizing', label: 'Sizing', icon: Calculator },
];

export function Sidebar() {
  const { activeTab, setActiveTab, screeningResults, isScreening } = useTradeStore();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navContent = (
    <nav className="flex flex-1 flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.id;
        return (
          <button
            key={item.id}
            onClick={() => {
              setActiveTab(item.id);
              setMobileOpen(false);
            }}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
              isActive
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="hidden lg:inline">{item.label}</span>
            {item.id === 'screener' && screeningResults.length > 0 && (
              <span className={cn(
                'ml-auto hidden h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold lg:flex',
                screeningResults.some(r => r.score === 6)
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-amber-500/20 text-amber-400'
              )}>
                {screeningResults.length}
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
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside className={cn(
        'fixed left-0 top-0 z-40 flex h-screen w-16 flex-col items-center border-r border-border bg-sidebar py-4 lg:w-56 lg:items-stretch lg:px-3 lg:py-6 transition-transform lg:translate-x-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        <div className="mb-8 flex items-center gap-2 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm lg:h-10 lg:w-10">
            VS
          </div>
          <div className="hidden lg:block">
            <div className="text-sm font-bold tracking-tight">V-Swing</div>
            <div className="text-[10px] text-muted-foreground">v65.5 Desk</div>
          </div>
        </div>

        {navContent}

        <div className="mt-auto px-2">
          <div className={cn(
            'flex items-center gap-2 rounded-lg px-3 py-2 text-xs',
            isScreening ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'
          )}>
            <div className={cn(
              'h-2 w-2 rounded-full',
              isScreening ? 'animate-pulse bg-amber-400' : 'bg-emerald-400'
            )} />
            <span className="hidden lg:inline">
              {isScreening ? 'Scanning...' : 'System Ready'}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}