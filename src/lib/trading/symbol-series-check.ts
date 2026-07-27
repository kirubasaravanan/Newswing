/**
 * Symbol trading-series check — catches the class of bug found manually
 * this session (4 of 74 SWING_PROVEN_SYMBOLS turned out to be trading under
 * restricted trade-to-trade settlement, not standard EQ, and the TATAMOTORS
 * demerger before that). A stock's real-world trading status can change
 * (corporate action, exchange surveillance) without anything in this
 * codebase's static proven-symbol lists knowing about it.
 *
 * Reads the same on-disk Dhan scrip master CSV that dhan-option-provider.ts
 * already maintains (downloaded fresh each trading day) — this module adds
 * no new data source, just a different read of data already being kept
 * current for other reasons.
 */
import fs from 'fs';
import path from 'path';

const SCRIP_MASTER_FILE = path.join(process.cwd(), 'db', 'dhan-scrip-master.csv');

export interface SeriesCheckResult {
  symbol: string;
  series: string | null; // null = not found in the scrip master at all (possible delisting/rename)
  restricted: boolean;    // true if found but not standard "EQ" (e.g. BE/BZ trade-to-trade)
}

/**
 * Look up the current NSE equity trading series for each symbol in one pass
 * over the scrip master file (not one file-scan per symbol — this file has
 * ~200K+ rows, so a single pass matters).
 */
export function checkSymbolSeries(symbols: string[]): SeriesCheckResult[] {
  const want = new Set(symbols.map((s) => s.toUpperCase()));
  const found = new Map<string, string>();

  if (!fs.existsSync(SCRIP_MASTER_FILE)) {
    // No local copy yet — can't check, report everything as unknown rather
    // than silently assuming "fine".
    return symbols.map((symbol) => ({ symbol, series: null, restricted: false }));
  }

  const lines = fs.readFileSync(SCRIP_MASTER_FILE, 'utf-8').split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.startsWith('NSE,E,')) continue;
    const parts = line.split(',');
    const tradingSymbol = (parts[5] || '').toUpperCase();
    if (!want.has(tradingSymbol) || found.has(tradingSymbol)) continue;
    found.set(tradingSymbol, (parts[14] || '').trim()); // SEM_SERIES column
  }

  return symbols.map((symbol) => {
    const series = found.get(symbol.toUpperCase()) ?? null;
    return { symbol, series, restricted: series !== null && series !== 'EQ' };
  });
}

/** Just the ones worth a warning — restricted series, or not found at all. */
export function findFlaggedSymbols(symbols: string[]): SeriesCheckResult[] {
  return checkSymbolSeries(symbols).filter((r) => r.restricted || r.series === null);
}
