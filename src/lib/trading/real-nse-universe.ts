/**
 * Real NSE index constituents — Nifty 100 + Nifty Midcap 150 + Nifty
 * Smallcap 250 (100+150+250=500, exactly how NSE defines the Nifty 500) —
 * fetched live from NSE's public archive CSVs. Unlike nse-universe.ts's
 * hand-typed ~600-line list (real duplicates across categories — TATAPOWER,
 * MARICO, SIEMENS etc. appear 2-3x — plus a handful of names that don't map
 * to any real listed company, and merged/delisted tickers like MINDTREE/LTI
 * treated as current), this is the actual official constituent data,
 * refetched live rather than maintained by hand.
 *
 * archives.nseindia.com serves these as plain static files — no session
 * cookie handshake needed, unlike nse-data.ts's option-chain API which
 * NSE's anti-bot layer blocks without a homepage cookie first.
 */

export interface RealNSEStock {
  symbol: string;
  name: string;
  sector: string;
  category: 'NIFTY100' | 'MIDCAP150' | 'SMALLCAP250';
}

const ARCHIVE_BASE = 'https://archives.nseindia.com/content/indices';
const INDEX_FILES: Array<{ file: string; category: RealNSEStock['category'] }> = [
  { file: 'ind_nifty100list.csv', category: 'NIFTY100' },
  { file: 'ind_niftymidcap150list.csv', category: 'MIDCAP150' },
  { file: 'ind_niftysmallcap250list.csv', category: 'SMALLCAP250' },
];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

let cache: RealNSEStock[] | null = null;
let cachedAt = 0;
// Index reconstitutions happen quarterly/semi-annually at most — 24h keeps
// this always effectively fresh without hammering NSE's archive on every call.
const CACHE_TTL = 24 * 60 * 60 * 1000;

function parseCsv(text: string): Array<{ name: string; sector: string; symbol: string }> {
  const lines = text.trim().split(/\r?\n/);
  const rows: Array<{ name: string; sector: string; symbol: string }> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 3) continue;
    rows.push({ name: cols[0].trim(), sector: cols[1].trim(), symbol: cols[2].trim().toUpperCase() });
  }
  return rows;
}

async function fetchIndexCsv(file: string): Promise<Array<{ name: string; sector: string; symbol: string }> | null> {
  try {
    const res = await fetch(`${ARCHIVE_BASE}/${file}`, {
      headers: { 'User-Agent': UA, Accept: 'text/csv,*/*' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[RealNSEUniverse] HTTP ${res.status} for ${file}`);
      return null;
    }
    return parseCsv(await res.text());
  } catch (err) {
    console.error(`[RealNSEUniverse] Fetch failed for ${file}:`, String(err).substring(0, 100));
    return null;
  }
}

/**
 * Fetch the real, official Nifty 100 + Midcap 150 + Smallcap 250 constituent
 * lists (= Nifty 500 by NSE's own construction) live from NSE's archive.
 * Returns null — never a partial list — if any of the three fetches fail,
 * so callers fall back to the static hand-typed universe rather than
 * silently working off an incomplete real list.
 */
export async function fetchRealNiftyUniverse(): Promise<RealNSEStock[] | null> {
  const now = Date.now();
  if (cache && now - cachedAt < CACHE_TTL) return cache;

  const results = await Promise.all(INDEX_FILES.map((f) => fetchIndexCsv(f.file)));
  if (results.some((r) => r === null)) {
    console.error('[RealNSEUniverse] One or more index CSVs failed — not caching a partial list');
    return cache;
  }

  const seen = new Set<string>();
  const universe: RealNSEStock[] = [];
  results.forEach((rows, i) => {
    const category = INDEX_FILES[i].category;
    for (const row of rows!) {
      const key = row.symbol.replace(/[^A-Z0-9&]/g, '');
      if (key.length >= 2 && !seen.has(key)) {
        seen.add(key);
        universe.push({ symbol: key, name: row.name, sector: row.sector, category });
      }
    }
  });

  cache = universe;
  cachedAt = now;
  return universe;
}
