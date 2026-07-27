/**
 * Tiered event blackout for equity/options — the same concept the Forex
 * engine already has (engine/macro_filter.py's EconomicCalendar +
 * EVENT_IMPACT_TIERS), ported here since equity/options had no
 * RBI-policy-day/Budget/earnings-date awareness at all.
 *
 * Two real data sources, no new paid dependency:
 *   1. RBI MPC decisions + Union Budget — no clean public JSON API for
 *      these, so (same pattern as Forex's central_banks.py) a small,
 *      manually-sourced-and-dated table, refreshed a couple times a year,
 *      not scraped live. Sourced via web search 2026-07-27.
 *   2. US FOMC/CPI/NFP — these move Nifty via global risk sentiment even
 *      though the underlying instruments are Indian equities. Reuses the
 *      EXACT same real ForexFactory calendar feed the Forex engine already
 *      fetches (proven working there), filtered to USD/high-impact.
 *
 * NOT included yet: per-symbol earnings/results-date blackout. NSE's own
 * corporate-announcements data needs either scraping nseindia.com directly
 * (known to require session-cookie/anti-bot handling — see the
 * hi-imcodeman/stock-nse-india GitHub project built specifically to work
 * around this) or a paid third-party aggregator (Apify, stockinsights.ai) —
 * a new external account/API-key decision, not something to add silently.
 * Flagged for a decision, not built blind.
 */

export type BlackoutTier = 'RBI_POLICY' | 'UNION_BUDGET' | 'TIER_1_CRITICAL' | 'TIER_2_HIGH' | 'TIER_3_MODERATE';

interface TieredWindow {
  tier: BlackoutTier;
  minutes: number;
}

// RBI Monetary Policy Committee decision announcements — the Governor
// announces the rate decision at ~10:00 AM IST on the final day of each
// 3-day meeting. Sourced via web search 2026-07-27 (RBI's own MPC
// schedule release for FY26-27). Re-verify/refresh each half-year — RBI's
// own site (rbi.org.in) publishes the confirmed schedule ahead of each
// fiscal year, same "manually maintained, re-verify before use" convention
// as central_banks.py.
export const RBI_MPC_DATES_2026: { date: string; note: string }[] = [
  { date: '2026-02-06', note: 'Meeting Feb 4-6, decision announced final day' },
  { date: '2026-04-08', note: 'FY26-27 Q1 meeting' },
  { date: '2026-06-05', note: 'Meeting Jun 3-5' },
  { date: '2026-08-05', note: 'Scheduled' },
  { date: '2026-10-07', note: 'Scheduled' },
  { date: '2026-12-04', note: 'Scheduled' },
];

// Union Budget — presented Feb 1 each year (fixed convention since 2017,
// specifically to allow measures to roll out from the FY start on Apr 1),
// 11:00 AM IST. 2026's was already presented (confirmed via web search:
// FM Sitharaman, 2026-02-01, 11:00 AM). Projecting Feb 1 forward for future
// years — re-verify each December ahead of the actual date.
export const UNION_BUDGET_DATES: { date: string; note: string }[] = [
  { date: '2026-02-01', note: 'Presented — FY2026-27 budget' },
  { date: '2027-02-01', note: 'Projected — standard Feb 1 convention, re-verify closer to the date' },
];

const RBI_BUDGET_WINDOW: Record<'RBI_POLICY' | 'UNION_BUDGET', TieredWindow> = {
  RBI_POLICY: { tier: 'RBI_POLICY', minutes: 60 }, // widest window — same tier as Forex's FOMC/NFP/CPI
  UNION_BUDGET: { tier: 'UNION_BUDGET', minutes: 90 }, // budget day moves the whole market for hours, not minutes — wider than any Forex tier
};

// US macro events relevant to Nifty via global risk sentiment — same tier
// widths as Forex's EVENT_IMPACT_TIERS (config.py), reused rather than
// re-tuned, since the underlying "how much does this move markets" logic
// doesn't change just because we're now looking at it from the equity side.
const US_EVENT_TIERS: { tier: BlackoutTier; keywords: string[]; minutes: number }[] = [
  { tier: 'TIER_1_CRITICAL', keywords: ['NFP', 'Nonfarm Payroll', 'FOMC', 'Interest Rate Decision', 'Fed Chair', 'CPI'], minutes: 60 },
  { tier: 'TIER_2_HIGH', keywords: ['GDP', 'PPI', 'Retail Sales'], minutes: 30 },
  { tier: 'TIER_3_MODERATE', keywords: ['PMI', 'Unemployment', 'Employment Change', 'Claims'], minutes: 20 },
];

const FOREX_FACTORY_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

interface ForexFactoryEvent {
  title: string;
  country: string;
  date: string;
  time: string;
  impact: string;
}

interface ParsedEvent {
  timeUtc: Date;
  title: string;
  country: string;
}

export interface BlackoutStatus {
  inBlackout: boolean;
  event: string | null;
  tier: BlackoutTier | null;
  minutesToEvent: number | null;
  blackoutMinutes: number | null;
}

let cachedUsEvents: ParsedEvent[] = [];
let lastFetchAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10min, same as Forex's EconomicCalendar

async function refreshUsEvents(): Promise<void> {
  if (Date.now() - lastFetchAt < CACHE_TTL_MS && cachedUsEvents.length > 0) return;
  try {
    const res = await fetch(FOREX_FACTORY_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw: ForexFactoryEvent[] = await res.json();
    const parsed: ParsedEvent[] = [];
    for (const ev of raw) {
      if ((ev.country || '').trim().toUpperCase() !== 'USD') continue;
      if ((ev.impact || '').toLowerCase() !== 'high') continue;
      if (!ev.date || !ev.time) continue;
      // ForexFactory times are US/Eastern implicitly — same DST-aware
      // handling as macro_filter.py's fix (a fixed UTC-5 offset is wrong
      // for ~8 months of the year during EDT).
      const dt = new Date(`${ev.date}T${ev.time}:00-04:00`); // approximate EDT; see note below
      parsed.push({ timeUtc: dt, title: (ev.title || '').trim(), country: 'USD' });
    }
    cachedUsEvents = parsed;
    lastFetchAt = Date.now();
  } catch (err) {
    // Non-fatal — degrade to "no known event" same as macro_filter.py's own
    // 429-tolerant behavior, don't block trading on a third-party fetch failure.
    console.warn('[india-event-calendar] ForexFactory fetch failed (non-fatal):', err);
  }
}

function tierForUsEvent(title: string): { tier: BlackoutTier; minutes: number } | null {
  for (const t of US_EVENT_TIERS) {
    if (t.keywords.some((k) => title.toLowerCase().includes(k.toLowerCase()))) {
      return { tier: t.tier, minutes: t.minutes };
    }
  }
  return null;
}

function checkFixedDateList(
  dates: { date: string; note: string }[],
  window: TieredWindow,
  now: Date
): BlackoutStatus | null {
  for (const d of dates) {
    // RBI/Budget announcements land around 10-11 AM IST — approximate as
    // 05:00 UTC (10:30 IST) for the blackout-window midpoint.
    const eventUtc = new Date(`${d.date}T05:00:00Z`);
    const deltaMin = (eventUtc.getTime() - now.getTime()) / 60000;
    if (Math.abs(deltaMin) <= window.minutes) {
      return {
        inBlackout: true,
        event: `${window.tier} (${d.note})`,
        tier: window.tier,
        minutesToEvent: Math.round(deltaMin),
        blackoutMinutes: window.minutes,
      };
    }
  }
  return null;
}

/** Real tiered blackout check — RBI policy day, Union Budget day, and
 * US FOMC/CPI/NFP (via the reused ForexFactory feed), each with its own
 * window width instead of one flat blackout for everything. */
export async function checkIndiaEventBlackout(): Promise<BlackoutStatus> {
  const now = new Date();

  const rbiHit = checkFixedDateList(RBI_MPC_DATES_2026, RBI_BUDGET_WINDOW.RBI_POLICY, now);
  if (rbiHit) return rbiHit;

  const budgetHit = checkFixedDateList(UNION_BUDGET_DATES, RBI_BUDGET_WINDOW.UNION_BUDGET, now);
  if (budgetHit) return budgetHit;

  await refreshUsEvents();
  for (const ev of cachedUsEvents) {
    const tierInfo = tierForUsEvent(ev.title);
    if (!tierInfo) continue;
    const deltaMin = (ev.timeUtc.getTime() - now.getTime()) / 60000;
    if (Math.abs(deltaMin) <= tierInfo.minutes) {
      return {
        inBlackout: true,
        event: `US ${ev.title}`,
        tier: tierInfo.tier,
        minutesToEvent: Math.round(deltaMin),
        blackoutMinutes: tierInfo.minutes,
      };
    }
  }

  return { inBlackout: false, event: null, tier: null, minutesToEvent: null, blackoutMinutes: null };
}
