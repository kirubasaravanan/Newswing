/**
 * Options session review — run this first thing after a real market session
 * to confirm the 2026-07-27 options changes (real IV, IV-regime gating,
 * order-flow/OI confluence veto, symbol reputation, score stabilizer,
 * portfolio drawdown breaker, capital-scaled daily caps) actually ran
 * cleanly against live data, not just that they typechecked.
 *
 * Run: node scripts/review-options-session.mjs [hours back, default 8]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const HOURS_BACK = parseFloat(process.argv[2]) || 8;

const NEW_ACTIONS = [
  'OPT_IV_STANDDOWN',       // IV spiked >=45%/hr — hard skip
  'OPT_OC_VETO',            // order-flow/OI contradicted the signal — skip
  'OPT_RISK_SIZING',        // risk-based lot sizing decision (should appear on every real entry attempt)
  'OPT_INSUFFICIENT_CAPITAL', // couldn't afford even 1 lot within risk budget
  'OPT_CIRCUIT_BREAKER',    // daily loss cap OR portfolio drawdown breaker
  'OPT_PROFIT_LOCK',        // daily profit lock hit
  'SWING_RESTRICTED_SYMBOL_ALERT', // T2T/delisting drift check
];

function bar(n, max, width = 30) {
  const filled = max > 0 ? Math.round((n / max) * width) : 0;
  return '#'.repeat(filled) + '.'.repeat(width - filled);
}

async function main() {
  const since = new Date(Date.now() - HOURS_BACK * 3600_000);
  console.log(`\n=== Options Session Review — last ${HOURS_BACK}h (since ${since.toISOString()}) ===\n`);

  const logs = await prisma.autoTradeLog.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
  });

  const optLogs = logs.filter(l => l.symbol?.includes('_') || NEW_ACTIONS.includes(l.action) || l.action === 'AUTO_ENTRY' || l.action.startsWith('AUTO_EXIT'));

  if (optLogs.length === 0) {
    console.log('No AutoTradeLog activity in this window at all — either the market was closed the whole time, or the scheduler never ran a scan. Check opt_lastScanAt / opt_enabled in AppSettings.');
    await prisma.$disconnect();
    return;
  }

  console.log(`Total log entries: ${optLogs.length}\n`);

  // 1. Action breakdown
  const byAction = new Map();
  for (const l of optLogs) byAction.set(l.action, (byAction.get(l.action) || 0) + 1);
  const maxCount = Math.max(...byAction.values());
  console.log('--- Action breakdown ---');
  for (const [action, count] of [...byAction.entries()].sort((a, b) => b[1] - a[1])) {
    const flag = NEW_ACTIONS.includes(action) ? ' <- new this session' : '';
    console.log(`  ${action.padEnd(28)} ${String(count).padStart(4)}  ${bar(count, maxCount)}${flag}`);
  }

  // 2. Any of the new guardrails actually fire?
  console.log('\n--- New-code activity (2026-07-27 session) ---');
  let anyNewActivity = false;
  for (const action of NEW_ACTIONS) {
    const matches = optLogs.filter(l => l.action === action);
    if (matches.length > 0) {
      anyNewActivity = true;
      console.log(`  ${action}: ${matches.length} occurrence(s)`);
      for (const m of matches.slice(0, 3)) console.log(`    - ${m.createdAt.toISOString()} ${m.symbol}: ${m.reason?.slice(0, 140)}`);
      if (matches.length > 3) console.log(`    ... and ${matches.length - 3} more`);
    }
  }
  if (!anyNewActivity) {
    console.log('  None of the new guardrail actions fired in this window.');
    console.log('  This is EXPECTED if no signal cleared the confluence bar this session (sniper mode, "a handful of trades a day, sometimes zero") — not itself a red flag.');
    console.log('  It only becomes a concern if AUTO_ENTRY rows exist below but skipped the new checks entirely (would indicate the new code path never actually executed).');
  }

  // 3. Real entries — check decisionVote trace is present (confirms the multi-factor pipeline actually ran)
  const entries = await prisma.paperTrade.findMany({
    where: { entryDate: { gte: since }, tags: { contains: 'options' } },
    orderBy: { entryDate: 'asc' },
  });
  console.log(`\n--- Real options entries this window: ${entries.length} ---`);
  for (const t of entries) {
    let notes = {};
    try { notes = JSON.parse(t.notes || '{}'); } catch {}
    const dv = notes.decisionVote;
    console.log(`  ${t.entryDate.toISOString()} ${t.symbol} qty=${t.qty} @ premium ${t.entryPrice}`);
    if (dv) {
      console.log(`    decisionVote: technical=${dv.technicalConfidence} ivPct=${dv.ivPercentile ?? 'n/a'} oc=${dv.ocConfluence ? `${dv.ocConfluence.entrySignal}(${dv.ocConfluence.score})` : 'n/a'} reputation=${dv.symbolReputation ?? 'none yet'} final=${dv.finalConfidence}`);
    } else {
      console.log('    ⚠ no decisionVote trace found on this trade — the new code may not have run for this entry (check which server build handled this scan).');
    }
  }

  // 4. Errors
  const errorish = logs.filter(l => /error|fail|exception/i.test(l.reason || ''));
  if (errorish.length > 0) {
    console.log(`\n--- Possible errors (${errorish.length}) ---`);
    for (const e of errorish.slice(0, 10)) console.log(`  ${e.createdAt.toISOString()} ${e.action} ${e.symbol}: ${e.reason?.slice(0, 200)}`);
  } else {
    console.log('\n--- No error-looking log entries in this window. ---');
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error('Review script failed:', e); process.exit(1); });
