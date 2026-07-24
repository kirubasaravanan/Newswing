/**
 * Indian Stock Market (NSE/BSE) Operational Schedule & Market Hours Utility
 * 
 * Schedule:
 * - 8:00 AM IST: Master Contract File Sync (Beginning of Day Token Refresh)
 * - 9:00 AM IST: System Activation & Pre-Open Market Gap Analysis
 * - 9:15 AM IST: Continuous Live Trading Starts
 * - 3:10 PM IST: Automated Position Square-Off Trigger (Auto-Exit before close)
 * - 3:30 PM IST: Market Close
 */

// 2026 NSE trading holidays (confirmed via Zerodha's official holiday
// calendar). NSE holidays that fall on a weekend (e.g. Diwali/Laxmi Pujan,
// Nov 8 2026, a Sunday — the weekday holiday is the following Balipratipada
// on Nov 10) are omitted since the weekend check already covers them.
// This list needs a one-line update each year once NSE publishes the next
// year's calendar — there is no API for this, it must be maintained by hand.
export const NSE_HOLIDAYS_2026: readonly string[] = [
  '2026-01-15', // Municipal Corporation Elections (Maharashtra)
  '2026-01-26', // Republic Day
  '2026-03-03', // Holi
  '2026-03-26', // Shri Ram Navami
  '2026-03-31', // Shri Mahavir Jayanti
  '2026-04-03', // Good Friday
  '2026-04-14', // Dr. Baba Saheb Ambedkar Jayanti
  '2026-05-01', // Maharashtra Day
  '2026-05-28', // Bakri Eid
  '2026-06-26', // Moharram
  '2026-09-14', // Ganesh Chaturthi
  '2026-10-02', // Mahatma Gandhi Jayanti
  '2026-10-20', // Dussehra
  '2026-11-10', // Diwali-Balipratipada
  '2026-11-24', // Prakash Gurpurb Sri Guru Nanak Dev
  '2026-12-25', // Christmas
];

/** IST calendar-date string (YYYY-MM-DD) for a given moment. */
function istDateStr(date: Date): string {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const utcMs = date.getTime() + (date.getTimezoneOffset() * 60 * 1000);
  return new Date(utcMs + istOffsetMs).toISOString().split('T')[0];
}

/** True if the given date (IST calendar day) is a published NSE trading holiday. */
export function isNseTradingHoliday(date: Date = new Date()): boolean {
  return NSE_HOLIDAYS_2026.includes(istDateStr(date));
}

export interface MarketStatus {
  isOpen: boolean;
  isWeekend: boolean;
  isHoliday: boolean;
  isPreOpen: boolean;
  isMasterFileUpdated: boolean;
  isAutoSquareOffActive: boolean;
  statusText: string;
  nextOpenText: string;
  timeToSquareOffMins: number;
  timeToCloseMins: number;
}

export function getIndianMarketStatus(date: Date = new Date()): MarketStatus {
  // Convert current time to IST (Asia/Kolkata UTC+5:30)
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const utcMs = date.getTime() + (date.getTimezoneOffset() * 60 * 1000);
  const istDate = new Date(utcMs + istOffsetMs);

  const dayOfWeek = istDate.getDay(); // 0 = Sunday, 6 = Saturday
  const hours = istDate.getHours();
  const minutes = istDate.getMinutes();
  const timeInMins = hours * 60 + minutes;

  const masterFileMins = 8 * 60;        // 8:00 AM IST (480 mins)
  const preOpenMins = 9 * 60;           // 9:00 AM IST (540 mins)
  const marketOpenMins = 9 * 60 + 15;   // 9:15 AM IST (555 mins)
  const autoSquareOffMins = 15 * 60 + 10; // 3:10 PM IST (910 mins)
  const marketCloseMins = 15 * 60 + 30; // 3:30 PM IST (930 mins)

  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isHoliday = !isWeekend && isNseTradingHoliday(date);
  const isNonTradingDay = isWeekend || isHoliday;
  const isPreOpen = !isNonTradingDay && timeInMins >= preOpenMins && timeInMins < marketOpenMins;
  const isMasterFileUpdated = !isNonTradingDay && timeInMins >= masterFileMins;
  const isWithinHours = !isNonTradingDay && timeInMins >= preOpenMins && timeInMins < marketCloseMins;
  const isAutoSquareOffActive = !isNonTradingDay && timeInMins >= autoSquareOffMins && timeInMins < marketCloseMins;

  const isOpen = !isNonTradingDay && isWithinHours;

  let statusText = '';
  let nextOpenText = '';
  let timeToSquareOffMins = 0;
  let timeToCloseMins = 0;

  if (isWeekend) {
    statusText = 'Market Closed (Weekend)';
    nextOpenText = 'Reopens Monday at 9:00 AM IST (Master Sync @ 8:00 AM)';
  } else if (isHoliday) {
    statusText = 'Market Closed (NSE Trading Holiday)';
    nextOpenText = 'Reopens next trading day at 9:00 AM IST';
  } else if (timeInMins < masterFileMins) {
    statusText = 'Early Morning (Pre-BOD)';
    const minsToMaster = masterFileMins - timeInMins;
    nextOpenText = `8 AM Master Sync in ${Math.floor(minsToMaster / 60)}h ${minsToMaster % 60}m`;
  } else if (timeInMins >= masterFileMins && timeInMins < preOpenMins) {
    statusText = 'BOD Master Contract Synced';
    const minsToPreOpen = preOpenMins - timeInMins;
    nextOpenText = `9 AM System Start in ${minsToPreOpen}m`;
  } else if (isPreOpen) {
    statusText = 'Pre-Open Session Active (9:00 AM Start)';
    nextOpenText = 'Continuous Trading at 9:15 AM IST';
  } else if (isAutoSquareOffActive) {
    statusText = '3:10 PM Auto-Square Off Active';
    timeToCloseMins = marketCloseMins - timeInMins;
    nextOpenText = `Market Close in ${timeToCloseMins}m`;
  } else if (timeInMins >= marketCloseMins) {
    statusText = 'Market Closed (After Hours)';
    nextOpenText = 'Reopens Tomorrow (8:00 AM Master Sync / 9:00 AM System Start)';
  } else {
    statusText = 'Market OPEN (Live Trading)';
    timeToSquareOffMins = autoSquareOffMins - timeInMins;
    timeToCloseMins = marketCloseMins - timeInMins;
    nextOpenText = `3:10 PM Auto-Close in ${Math.floor(timeToSquareOffMins / 60)}h ${timeToSquareOffMins % 60}m`;
  }

  return {
    isOpen,
    isWeekend,
    isHoliday,
    isPreOpen,
    isMasterFileUpdated,
    isAutoSquareOffActive,
    statusText,
    nextOpenText,
    timeToSquareOffMins,
    timeToCloseMins,
  };
}

export function isIndianMarketOpen(date: Date = new Date()): boolean {
  return getIndianMarketStatus(date).isOpen;
}

export function shouldAutoSquareOff(date: Date = new Date()): boolean {
  return getIndianMarketStatus(date).isAutoSquareOffActive;
}
