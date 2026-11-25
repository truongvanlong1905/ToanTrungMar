/**
 * Canonical reporting date range calculation for Toan Trung CRM.
 * Enforces consistent inclusive boundaries, exact N-calendar-day counts,
 * and Asia/Ho_Chi_Minh (UTC+7) timezone across M02, M03, M04, and exports.
 */

function getVietnamDateParts(referenceDate = new Date()) {
  const d = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.format(d); // "YYYY-MM-DD"
  const [year, month, day] = parts.split('-').map((v) => parseInt(v, 10));
  return { year, month, day, dateStr: parts };
}

function formatVietnamDate(date) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '—';
  return getVietnamDateParts(d).dateStr;
}

function formatVietnamDateTime(date) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '—';
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return formatter.format(d).replace(',', '');
}

function getCanonicalDateRange(periodDays, referenceDate = new Date(), timezone = 'Asia/Ho_Chi_Minh') {
  const safeDays = Math.max(1, Math.round(periodDays));
  const { dateStr: endDateStr } = getVietnamDateParts(referenceDate);

  // Compute start date by subtracting (safeDays - 1) from endDate in UTC+7
  const endD = new Date(`${endDateStr}T12:00:00+07:00`);
  const startD = new Date(endD.getTime() - (safeDays - 1) * 24 * 60 * 60 * 1000);
  const { dateStr: startDateStr } = getVietnamDateParts(startD);

  const startDateTime = new Date(`${startDateStr}T00:00:00.000+07:00`);
  const endDateTime = new Date(`${endDateStr}T23:59:59.999+07:00`);

  return {
    startDateStr,
    endDateStr,
    startDateTime,
    endDateTime,
    totalCalendarDays: safeDays,
    timezone,
    isTodayIncluded: true,
    isPartialDay: true,
  };
}

function isValidCalendarYmd(ymdStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymdStr)) return false;
  const [y, m, d] = ymdStr.split('-').map((n) => parseInt(n, 10));
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function getCustomCanonicalDateRange(fromStr, toStr, timezone = 'Asia/Ho_Chi_Minh') {
  if (!fromStr || !toStr) {
    return getCanonicalDateRange(30, new Date(), timezone);
  }
  let cleanFrom = String(fromStr).slice(0, 10);
  let cleanTo = String(toStr).slice(0, 10);

  // Strictly validate real calendar dates YYYY-MM-DD (reject rollover dates like 2026-02-31)
  if (!isValidCalendarYmd(cleanFrom) || !isValidCalendarYmd(cleanTo)) {
    return getCanonicalDateRange(30, new Date(), timezone);
  }

  // Handle reversed dates (if from > to, swap them)
  if (cleanFrom > cleanTo) {
    const temp = cleanFrom;
    cleanFrom = cleanTo;
    cleanTo = temp;
  }

  const { dateStr: todayStr } = getVietnamDateParts();

  const startDateTime = new Date(`${cleanFrom}T00:00:00.000+07:00`);
  const endDateTime = new Date(`${cleanTo}T23:59:59.999+07:00`);

  const totalCalendarDays = countInclusiveCalendarDays(cleanFrom, cleanTo);

  return {
    startDateStr: cleanFrom,
    endDateStr: cleanTo,
    startDateTime,
    endDateTime,
    totalCalendarDays,
    timezone,
    isTodayIncluded: cleanTo >= todayStr,
    isPartialDay: cleanTo >= todayStr,
  };
}

function countInclusiveCalendarDays(startDateStr, endDateStr) {
  if (!startDateStr || !endDateStr) return 0;
  const sMs = Date.parse(`${String(startDateStr).slice(0, 10)}T00:00:00Z`);
  const eMs = Date.parse(`${String(endDateStr).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(sMs) || !Number.isFinite(eMs) || eMs < sMs) return 0;
  return Math.round((eMs - sMs) / (24 * 60 * 60 * 1000)) + 1;
}

function getYesterdayCanonicalDateRange(referenceDate = new Date(), timezone = 'Asia/Ho_Chi_Minh') {
  const { dateStr: todayStr } = getVietnamDateParts(referenceDate);
  const todayNoon = new Date(`${todayStr}T12:00:00+07:00`);
  const yesterdayD = new Date(todayNoon.getTime() - 24 * 60 * 60 * 1000);
  const { dateStr: yesterdayStr } = getVietnamDateParts(yesterdayD);

  return {
    startDateStr: yesterdayStr,
    endDateStr: yesterdayStr,
    startDateTime: new Date(`${yesterdayStr}T00:00:00.000+07:00`),
    endDateTime: new Date(`${yesterdayStr}T23:59:59.999+07:00`),
    totalCalendarDays: 1,
    timezone,
    isTodayIncluded: false,
    isPartialDay: false,
  };
}

function getThisMonthCanonicalDateRange(referenceDate = new Date(), timezone = 'Asia/Ho_Chi_Minh') {
  const { year, month, dateStr: todayStr } = getVietnamDateParts(referenceDate);
  const monthStr = String(month).padStart(2, '0');
  const startDateStr = `${year}-${monthStr}-01`;
  return getCustomCanonicalDateRange(startDateStr, todayStr, timezone);
}

function resolveDatePresetRange(
  preset = '30D',
  fromStr,
  toStr,
  referenceDate = new Date(),
  timezone = 'Asia/Ho_Chi_Minh',
) {
  const norm = String(preset || '30D').toUpperCase();
  if (norm === 'CUSTOM' && fromStr && toStr) {
    return getCustomCanonicalDateRange(fromStr, toStr, timezone);
  }
  if (norm === 'TODAY' || norm === '1D') {
    return getCanonicalDateRange(1, referenceDate, timezone);
  }
  if (norm === 'YESTERDAY') {
    return getYesterdayCanonicalDateRange(referenceDate, timezone);
  }
  if (norm === '7D') {
    return getCanonicalDateRange(7, referenceDate, timezone);
  }
  if (norm === '90D') {
    return getCanonicalDateRange(90, referenceDate, timezone);
  }
  if (norm === 'THIS_MONTH') {
    return getThisMonthCanonicalDateRange(referenceDate, timezone);
  }
  return getCanonicalDateRange(30, referenceDate, timezone);
}

module.exports = {
  isValidCalendarYmd,
  getVietnamDateParts,
  formatVietnamDate,
  formatVietnamDateTime,
  getCanonicalDateRange,
  getCustomCanonicalDateRange,
  getYesterdayCanonicalDateRange,
  getThisMonthCanonicalDateRange,
  resolveDatePresetRange,
  countInclusiveCalendarDays,
};
