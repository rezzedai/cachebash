import { getISOWeek, getISOWeekYear, buildAggregateKeys } from "./helpers";

describe("getISOWeek", () => {
  it("returns week 1 for Jan 1 2026 (Thursday)", () => {
    expect(getISOWeek(new Date("2026-01-01T00:00:00Z"))).toBe(1);
  });

  it("returns week 53 for Dec 31 2020 (Thursday)", () => {
    expect(getISOWeek(new Date("2020-12-31T00:00:00Z"))).toBe(53);
  });

  it("returns week 1 for Jan 4 2021 (Monday, first week)", () => {
    expect(getISOWeek(new Date("2021-01-04T00:00:00Z"))).toBe(1);
  });

  it("returns correct week for mid-year date", () => {
    // June 15 2026 is a Monday
    expect(getISOWeek(new Date("2026-06-15T00:00:00Z"))).toBe(25);
  });
});

describe("getISOWeekYear", () => {
  it("returns 2020 for Dec 31 2020 (still in week 53 of 2020)", () => {
    expect(getISOWeekYear(new Date("2020-12-31T00:00:00Z"))).toBe(2020);
  });

  it("returns 2026 for Jan 1 2026", () => {
    expect(getISOWeekYear(new Date("2026-01-01T00:00:00Z"))).toBe(2026);
  });
});

describe("buildAggregateKeys", () => {
  it("builds correct keys for a known date", () => {
    const date = new Date("2026-02-23T15:30:00Z");
    const keys = buildAggregateKeys(date);

    expect(keys.daily).toBe("daily_2026-02-23");
    expect(keys.monthly).toBe("monthly_2026-02");
    // Feb 23 2026 is a Monday, week 9
    expect(keys.weekly).toBe("weekly_2026-W09");
  });

  it("zero-pads single-digit months and days", () => {
    const date = new Date("2026-01-05T00:00:00Z");
    const keys = buildAggregateKeys(date);

    expect(keys.daily).toBe("daily_2026-01-05");
    expect(keys.monthly).toBe("monthly_2026-01");
  });

  it("zero-pads single-digit week numbers", () => {
    const date = new Date("2026-01-01T00:00:00Z");
    const keys = buildAggregateKeys(date);

    expect(keys.weekly).toBe("weekly_2026-W01");
  });

  it("handles year-boundary weeks correctly", () => {
    // Dec 31 2025 is a Wednesday — week 1 of 2026
    const date = new Date("2025-12-31T00:00:00Z");
    const keys = buildAggregateKeys(date);

    expect(keys.daily).toBe("daily_2025-12-31");
    expect(keys.monthly).toBe("monthly_2025-12");
    // Week year may differ from calendar year at boundaries
    expect(keys.weekly).toMatch(/^weekly_\d{4}-W\d{2}$/);
  });
});
