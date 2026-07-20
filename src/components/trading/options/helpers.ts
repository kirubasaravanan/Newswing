'use client';

export const safeJson = async (res: Response | null) => {
  if (!res) return null;
  try { return await res.json(); } catch { return null; }
};

export const fetchSafe = async (url: string) => {
  const res = await fetch(url).catch(() => null);
  return res ? await safeJson(res) : null;
};

export const fmt = (n: number | null | undefined, decimals = 2) => {
  if (n == null) return '—';
  return n.toFixed(decimals);
};

export const fmtRupee = (n: number | null | undefined) => {
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  if (abs >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
};