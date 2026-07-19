import { describe, expect, it } from "vitest";
import {
  formatHistoryDateTime,
  formatHistoryTime,
} from "@/features/query-history/query-history-utils";

// History timestamps rendered month/day only and always in the OS locale
// (#121): a January entry viewed the next year looked current, and the app
// language setting was ignored. The formatters now take the app locale and add
// the year for entries from previous years.

// Midday UTC so no timezone can shift the calendar date across a year edge.
const ranAt = "2023-03-05T12:00:00Z";

describe("query history time formatting", () => {
  it("adds the year to entries from previous years", () => {
    expect(
      formatHistoryDateTime(ranAt, "en", new Date("2026-07-01T12:00:00Z")),
    ).toContain("2023");
    expect(
      formatHistoryDateTime(ranAt, "en", new Date("2023-07-01T12:00:00Z")),
    ).not.toContain("2023");
  });

  it("formats in the app locale rather than the OS locale", () => {
    const now = new Date("2026-07-01T12:00:00Z");
    expect(formatHistoryDateTime(ranAt, "ja", now)).not.toBe(
      formatHistoryDateTime(ranAt, "en-US", now),
    );
    expect(formatHistoryTime(ranAt, "ja")).not.toBe(
      formatHistoryTime(ranAt, "en-US"),
    );
  });

  it("keeps the invalid-timestamp fallbacks", () => {
    expect(formatHistoryDateTime("not a date", "en")).toBe("Unknown time");
    expect(formatHistoryTime("not a date", "en")).toBe("--:--");
  });
});
