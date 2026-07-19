import { describe, expect, it } from "vitest";
import {
  tokenizeLogLine,
  type LogToken,
} from "@/features/query-editor/editor-log-highlight";

function tokenText(line: string, token: LogToken): string {
  return line.slice(token.from, token.to);
}

describe("tokenizeLogLine", () => {
  it("classifies severity keywords case-insensitively", () => {
    const line = "error then Warning then info then DEBUG then trace";
    const tokens = tokenizeLogLine(line);
    expect(tokens.map((token) => [tokenText(line, token), token.kind])).toEqual(
      [
        ["error", "error"],
        ["Warning", "warn"],
        ["info", "info"],
        ["DEBUG", "debug"],
        ["trace", "trace"],
      ],
    );
  });

  it("maps fatal/err to error and verbose to trace, on word boundaries only", () => {
    const line = "FATAL err stderr information verbose";
    const tokens = tokenizeLogLine(line);
    expect(tokens.map((token) => [tokenText(line, token), token.kind])).toEqual(
      [
        ["FATAL", "error"],
        ["err", "error"],
        ["verbose", "trace"],
      ],
    );
  });

  it("highlights ISO-ish timestamps", () => {
    const line = "2026-07-18T12:34:56.789Z started 2026/07/18 and 09:15:00";
    const tokens = tokenizeLogLine(line);
    expect(tokens.map((token) => [tokenText(line, token), token.kind])).toEqual(
      [
        ["2026-07-18T12:34:56.789Z", "timestamp"],
        ["2026/07/18", "timestamp"],
        ["09:15:00", "timestamp"],
      ],
    );
  });

  it("splits bracketed sections around the severity keyword inside them", () => {
    const line = "[2026-07-18 08:00:00] [ERROR] [worker-3] boom";
    const tokens = tokenizeLogLine(line);
    expect(tokens.map((token) => [tokenText(line, token), token.kind])).toEqual(
      [
        ["[", "bracket"],
        ["2026-07-18 08:00:00", "timestamp"],
        ["]", "bracket"],
        ["[", "bracket"],
        ["ERROR", "error"],
        ["]", "bracket"],
        ["[worker-3]", "bracket"],
      ],
    );
  });

  it("returns no tokens for plain prose lines", () => {
    expect(tokenizeLogLine("just a message with no markers")).toEqual([]);
  });
});
