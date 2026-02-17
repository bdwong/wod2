import { describe, expect, test } from "bun:test";
import type { LsResult } from "./ls-formatter.ts";
import { formatLsOutput } from "./ls-formatter.ts";

describe("formatLsOutput", () => {
  test("prints message when no instances exist", () => {
    const result: LsResult = { instances: [], dockerRunning: true };
    expect(formatLsOutput(result)).toBe("No wod instances found.");
  });

  test("prints message when no instances and Docker not running", () => {
    const result: LsResult = { instances: [], dockerRunning: false };
    expect(formatLsOutput(result)).toBe("No wod instances found.");
  });

  test("formats a single running instance with siteurl", () => {
    const result: LsResult = {
      dockerRunning: true,
      instances: [
        { name: "staging-b", dbRunning: true, wpRunning: true, siteUrl: "http://127.0.0.1:8000" },
      ],
    };
    const output = formatLsOutput(result);
    const lines = output.split("\n");
    expect(lines[0]).toBe("d w |");
    expect(lines[1]).toBe("b p | name");
    expect(lines[2]).toBe("====#=========================");
    expect(lines[3]).toBe("* * | staging-b at http://127.0.0.1:8000");
  });

  test("formats a single stopped instance", () => {
    const result: LsResult = {
      dockerRunning: true,
      instances: [{ name: "old-site", dbRunning: false, wpRunning: false, siteUrl: null }],
    };
    const output = formatLsOutput(result);
    const lines = output.split("\n");
    expect(lines[3]).toBe(". . | old-site");
  });

  test("formats instances when Docker is not running", () => {
    const result: LsResult = {
      dockerRunning: false,
      instances: [{ name: "mysite", dbRunning: false, wpRunning: false, siteUrl: null }],
    };
    const output = formatLsOutput(result);
    const lines = output.split("\n");
    expect(lines[3]).toBe("E E | mysite");
  });

  test("formats mixed running and stopped instances", () => {
    const result: LsResult = {
      dockerRunning: true,
      instances: [
        { name: "active", dbRunning: true, wpRunning: true, siteUrl: "http://127.0.0.1:8000" },
        { name: "stopped", dbRunning: false, wpRunning: false, siteUrl: null },
        {
          name: "partial",
          dbRunning: true,
          wpRunning: false,
          siteUrl: null,
        },
      ],
    };
    const output = formatLsOutput(result);
    const lines = output.split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[3]).toBe("* * | active at http://127.0.0.1:8000");
    expect(lines[4]).toBe(". . | stopped");
    expect(lines[5]).toBe("* . | partial");
  });

  test("always includes header when instances exist", () => {
    const result: LsResult = {
      dockerRunning: true,
      instances: [{ name: "x", dbRunning: false, wpRunning: false, siteUrl: null }],
    };
    const output = formatLsOutput(result);
    expect(output).toContain("d w |");
    expect(output).toContain("b p | name");
    expect(output).toContain("====#=========================");
  });
});
