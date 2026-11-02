const WIB_OFFSET = "+07:00";
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?$/;
const ZONED_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

function isValidCalendarDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear =
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysPerMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysPerMonth[month - 1];
}

function isValidClockTime(hour, minute, second = 0) {
  return hour <= 23 && minute <= 59 && second <= 59;
}

function parseDate(value, { dateOnlyAsUTC = false } = {}) {
  if (value === undefined || value === null || value === "") return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? new Date(value) : null;
  }

  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  const dateOnly = DATE_PATTERN.exec(raw);
  if (dateOnly) {
    const [, yearText, monthText, dayText] = dateOnly;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    if (!isValidCalendarDate(year, month, day)) return null;

    const suffix = dateOnlyAsUTC ? "Z" : WIB_OFFSET;
    return new Date(`${raw}T00:00:00.000${suffix}`);
  }

  const zonedDateTime = ZONED_DATE_TIME_PATTERN.exec(raw);
  const localDateTime = DATE_TIME_PATTERN.exec(raw);
  const match = zonedDateTime ?? localDateTime;
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText ?? 0);

  if (
    !isValidCalendarDate(year, month, day) ||
    !isValidClockTime(hour, minute, second)
  ) {
    return null;
  }

  const normalized = zonedDateTime
    ? raw
    : `${raw.replace(" ", "T")}${WIB_OFFSET}`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseTime(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return null;

  const raw = value.trim();
  if (!raw) return null;
  const match = TIME_PATTERN.exec(raw);
  if (!match) return null;

  const [, hourText, minuteText, secondText] = match;
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText ?? 0);
  if (!isValidClockTime(hour, minute, second)) return null;

  return new Date(
    `1970-01-01T${hourText}:${minuteText}:${String(second).padStart(2, "0")}.000Z`,
  );
}

function getWibDateLabel(date) {
  const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function combineWIB(date, time) {
  let dateLabel;
  if (typeof date === "string" && DATE_PATTERN.test(date.trim())) {
    dateLabel = date.trim();
    if (!parseDate(dateLabel, { dateOnlyAsUTC: true })) return null;
  } else {
    const parsedDate = parseDate(date);
    if (!parsedDate) return null;
    dateLabel = getWibDateLabel(parsedDate);
  }

  const parsedTime = parseTime(time);
  if (!parsedTime) return null;

  const hours = String(parsedTime.getUTCHours()).padStart(2, "0");
  const minutes = String(parsedTime.getUTCMinutes()).padStart(2, "0");
  const seconds = String(parsedTime.getUTCSeconds()).padStart(2, "0");
  return new Date(`${dateLabel}T${hours}:${minutes}:${seconds}.000${WIB_OFFSET}`);
}

function formatWIB(value, options = {}) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("id-ID", {
    ...options,
    timeZone: "Asia/Jakarta",
  }).format(date);
}

function formatTimeUTC(value) {
  const date = value instanceof Date ? value : parseTime(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

module.exports = {
  parseDate,
  parseTime,
  combineWIB,
  formatWIB,
  formatTimeUTC,
};
