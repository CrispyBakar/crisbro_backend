const {
  combineWIB,
  formatTimeUTC,
  formatWIB,
  parseDate,
  parseTime,
} = require("../src/utils/datetime");

describe("datetime helpers", () => {
  test.each([
    ["2026-11-02", "2026-11-01T17:00:00.000Z"],
    ["2026-11-02T10:10:00", "2026-11-02T03:10:00.000Z"],
    ["2026-11-02T10:10:00Z", "2026-11-02T10:10:00.000Z"],
    ["2026-11-02T10:10:00+07:00", "2026-11-02T03:10:00.000Z"],
  ])("parses %s to a timezone-independent instant", (value, expected) => {
    expect(parseDate(value)?.toISOString()).toBe(expected);
  });

  test("preserves date-only values for PostgreSQL DATE columns", () => {
    expect(
      parseDate("2026-11-02", { dateOnlyAsUTC: true })?.toISOString(),
    ).toBe("2026-11-02T00:00:00.000Z");
  });

  test.each(["", null, undefined, "not a date", "2026-02-31"])(
    "returns null for invalid or empty date %s",
    (value) => {
      expect(parseDate(value)).toBeNull();
    },
  );

  test.each([
    ["10:10", "1970-01-01T10:10:00.000Z"],
    ["10:10:00", "1970-01-01T10:10:00.000Z"],
  ])("parses time %s as UTC", (value, expected) => {
    expect(parseTime(value)?.toISOString()).toBe(expected);
  });

  test.each(["", null, undefined, "25:10", "10:60", "invalid"])(
    "returns null for invalid or empty time %s",
    (value) => {
      expect(parseTime(value)).toBeNull();
    },
  );

  test.each([
    ["2026-11-02", "23:30", "2026-11-02T16:30:00.000Z"],
    ["2026-11-02", "00:30", "2026-11-01T17:30:00.000Z"],
  ])("combines %s and %s as a WIB wall-clock time", (date, time, expected) => {
    const instant = combineWIB(date, time);
    expect(instant?.toISOString()).toBe(expected);
    expect(
      formatWIB(instant, { year: "numeric", month: "2-digit", day: "2-digit" }),
    ).toContain("02");
  });

  test("formats display values in WIB and time-column values in UTC", () => {
    const instant = parseDate("2026-11-02T10:10:00Z");
    expect(
      formatWIB(instant, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }),
    ).toContain("17");
    expect(formatTimeUTC(parseTime("10:10"))).toBe("10:10:00");
  });
});
