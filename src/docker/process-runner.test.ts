import { describe, expect, test } from "bun:test";
import { BunProcessRunner } from "./process-runner.ts";

describe("BunProcessRunner", () => {
  const runner = new BunProcessRunner();

  test("returns stdout from a successful command", () => {
    const result = runner.run(["echo", "hello"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello\n");
    expect(result.stderr).toBe("");
  });

  test("returns non-zero exit code for a failing command", () => {
    const result = runner.run(["false"]);
    expect(result.exitCode).not.toBe(0);
  });

  test("captures stderr output", () => {
    const result = runner.run(["bash", "-c", "echo error >&2"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("error\n");
  });
});
