// Rentang tanggal untuk filter periode dashboard (?period=week|month|3_months|year).
//
// Setiap periode dihitung "to date" dalam kalender WIB: dari awal periode
// sampai hari ini. Periode pembanding adalah rentang yang sama persis satu
// periode sebelumnya, misalnya "month" pada 25 Sep dibandingkan 1-25 Sep
// dengan 1-25 Agu (bukan 25 hari sebelum 1 Sep). Aturan awal periode harus
// sama dengan getPeriodRange() di frontend (src/lib/period.ts).
//
// Aritmetika kalender hanya memakai API UTC (lihat alasan di wibDate.js).

const { endOfWibDay, getWibDateParts, parseWibInstant } = require("./wibDate");

const DASHBOARD_PERIODS = ["week", "month", "3_months", "year"];

// Tanpa filter tanggal; tidak punya rentang maupun periode pembanding sehingga
// tidak diproses getDashboardPeriodRange().
const ALL_TIME_PERIOD = "all";

const pad = (n) => String(n).padStart(2, "0");
const toDateString = ({ year, month, day }) =>
  `${year}-${pad(month)}-${pad(day)}`;

function addDays({ year, month, day }, days) {
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Tanggal dijepit ke akhir bulan tujuan: 31 Mar mundur 1 bulan -> 28/29 Feb.
function addMonths({ year, month, day }, months) {
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  return {
    year: targetYear,
    month: targetMonth,
    day: Math.min(day, daysInMonth(targetYear, targetMonth)),
  };
}

function getPeriodStart(today, period) {
  switch (period) {
    case "week": {
      // Minggu dimulai Senin
      const weekday = new Date(
        Date.UTC(today.year, today.month - 1, today.day),
      ).getUTCDay();
      return addDays(today, -((weekday + 6) % 7));
    }
    case "month":
      return { ...today, day: 1 };
    case "3_months":
      // Bulan berjalan + 2 bulan sebelumnya
      return addMonths({ ...today, day: 1 }, -2);
    case "year":
      return { year: today.year, month: 1, day: 1 };
    default:
      throw new Error(`Unknown dashboard period: ${period}`);
  }
}

function shiftToPreviousPeriod(date, period) {
  switch (period) {
    case "week":
      return addDays(date, -7);
    case "month":
      return addMonths(date, -1);
    case "3_months":
      return addMonths(date, -3);
    case "year":
      return addMonths(date, -12);
    default:
      throw new Error(`Unknown dashboard period: ${period}`);
  }
}

// start/end: label 'YYYY-MM-DD' (inklusif) untuk response API.
// start_at/end_at: instant batas bawah/atas untuk query ke database.
function toRange(start, end) {
  const startDate = toDateString(start);
  const endDate = toDateString(end);
  return {
    start: startDate,
    end: endDate,
    start_at: parseWibInstant(startDate),
    end_at: endOfWibDay(parseWibInstant(endDate)),
  };
}

function getDashboardPeriodRange(period, now = new Date()) {
  const today = getWibDateParts(now);
  const start = getPeriodStart(today, period);

  return {
    current: toRange(start, today),
    previous: toRange(
      shiftToPreviousPeriod(start, period),
      shiftToPreviousPeriod(today, period),
    ),
  };
}

module.exports = {
  ALL_TIME_PERIOD,
  DASHBOARD_PERIODS,
  getDashboardPeriodRange,
};
