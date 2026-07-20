/**
 * Reusable API fetch hooks using React Query.
 * Replaces raw fetch/useState/useEffect pattern across all components.
 */
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ── Generic safe fetch (handles non-JSON errors) ──────────────

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }
  try {
    const json = await res.json();
    return json as T;
  } catch {
    throw new Error('Invalid JSON response');
  }
}

// ── Trade Hooks ──────────────────────────────────────────────

export function useTrades() {
  return useQuery({
    queryKey: ['trades'],
    queryFn: () => apiFetch<{ success: boolean; trades: any[] }>('/api/trades'),
    select: (data) => data.trades,
  });
}

export function useOpenTrades() {
  return useQuery({
    queryKey: ['trades', 'open'],
    queryFn: () => apiFetch<{ success: boolean; trades: any[] }>('/api/trades'),
    select: (data) => data.trades.filter((t: any) => t.status === 'OPEN'),
  });
}

export function useCreateTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch('/api/trades', { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['trades'] }); qc.invalidateQueries({ queryKey: ['wallet'] }); },
  });
}

export function useCloseTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch('/api/trades', { method: 'PUT', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['trades'] }); qc.invalidateQueries({ queryKey: ['wallet'] }); qc.invalidateQueries({ queryKey: ['portfolio'] }); },
  });
}

// ── Options Hooks ────────────────────────────────────────────

export function useOptionTrades(status?: string) {
  const params = status && status !== 'ALL' ? `?status=${status}` : '';
  return useQuery({
    queryKey: ['optionTrades', status],
    queryFn: () => apiFetch<{ success: boolean; trades: any[] }>(`/api/options/trades${params}`),
    select: (data) => data.trades,
  });
}

export function useOptionChain(symbol: string, expiry: string, enabled = true) {
  return useQuery({
    queryKey: ['optionChain', symbol, expiry],
    queryFn: () => apiFetch<{ success: boolean; chain: any[] }>(
      `/api/options/chain?symbol=${encodeURIComponent(symbol)}&expiry=${encodeURIComponent(expiry)}`
    ),
    enabled: enabled && !!symbol && !!expiry,
    staleTime: 15_000, // 15s for option chain
  });
}

export function useOptionStrategies() {
  return useQuery({
    queryKey: ['optionStrategies'],
    queryFn: () => apiFetch<{ success: boolean; strategies: any[] }>('/api/options/strategies'),
    select: (data) => data.strategies,
  });
}

export function useCreateOptionTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch('/api/options/trades', { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['optionTrades'] }); },
  });
}

export function useCloseOptionTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch('/api/options/trades', { method: 'PUT', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['optionTrades'] }); },
  });
}

export function useCreateStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch('/api/options/strategies', { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['optionStrategies'] }); qc.invalidateQueries({ queryKey: ['optionTrades'] }); },
  });
}

// ── VIX Hook ─────────────────────────────────────────────────

export function useVIX() {
  return useQuery({
    queryKey: ['vix'],
    queryFn: () => apiFetch<any>('/api/options/vix'),
    staleTime: 60_000, // 1 min
    refetchInterval: 60_000,
  });
}

// ── Portfolio Hooks ──────────────────────────────────────────

export function usePortfolioGreeks() {
  return useQuery({
    queryKey: ['portfolioGreeks'],
    queryFn: () => apiFetch<any>('/api/options/portfolio-greeks'),
    staleTime: 15_000,
  });
}

export function usePortfolioSummary() {
  return useQuery({
    queryKey: ['portfolio'],
    queryFn: () => apiFetch<any>('/api/portfolio/summary'),
    staleTime: 30_000,
  });
}

export function usePortfolios() {
  return useQuery({
    queryKey: ['portfolios'],
    queryFn: () => apiFetch<{ success: boolean; portfolios: any[] }>('/api/portfolios'),
    select: (data) => data.portfolios,
  });
}

// ── Journal Hook ─────────────────────────────────────────────

export function useJournal() {
  return useQuery({
    queryKey: ['journal'],
    queryFn: () => apiFetch<{ success: boolean; entries: any[] }>('/api/journal'),
    select: (data) => data.entries,
  });
}

export function useUpsertJournal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch('/api/journal', { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['journal'] }),
  });
}

// ── Screener Hook ────────────────────────────────────────────

export function useScreeningResults() {
  return useQuery({
    queryKey: ['screeningResults'],
    queryFn: () => apiFetch<{ success: boolean; results: any[] }>('/api/screener'),
    select: (data) => data.results,
    staleTime: 60_000,
  });
}

export function useRunScreener() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch('/api/screener', { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['screeningResults'] }),
  });
}

// ── Watchlist Hook ───────────────────────────────────────────

export function useWatchlist() {
  return useQuery({
    queryKey: ['watchlist'],
    queryFn: () => apiFetch<{ success: boolean; stocks: any[] }>('/api/watchlist'),
    select: (data) => data.stocks,
    staleTime: 60_000,
  });
}

// ── Live PnL Hook ────────────────────────────────────────────

export function useLivePnL() {
  return useQuery({
    queryKey: ['livePnl'],
    queryFn: () => apiFetch<any>('/api/live-pnl'),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });
}