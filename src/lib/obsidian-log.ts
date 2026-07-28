/**
 * Append-only logging into the user's Obsidian vault — shares the same log
 * file as the Forex engine's engine/obsidian_log.py (Python) so both
 * engines' hourly postmortem findings land in one running record, kept
 * separate from the manually-curated progress log.
 */
import fs from 'fs';

const OBSIDIAN_LOG_PATH = 'C:\\Users\\user\\Documents\\Obsidian Vault\\Trading Engines\\Hourly Postmortem Log.md';

export function appendObsidianEntry(title: string, body: string): void {
  try {
    const istNow = new Date(Date.now() + 5.5 * 3600000);
    const stamp = istNow.toISOString().slice(0, 16).replace('T', ' ');
    const entry = `\n## ${stamp} IST — ${title}\n\n${body}\n`;
    fs.appendFileSync(OBSIDIAN_LOG_PATH, entry, 'utf-8');
  } catch (err) {
    console.error('[obsidian-log] write failed:', err);
  }
}
