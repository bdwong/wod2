import { describe, expect, test } from "bun:test";
import { MockProcessRunner } from "../docker/mock-process-runner.ts";
import { MockFilesystem } from "../utils/mock-filesystem.ts";
import { type DownDependencies, downInstance } from "./down.ts";

function createDeps(overrides?: Partial<DownDependencies>): DownDependencies {
  return {
    processRunner: overrides?.processRunner ?? new MockProcessRunner(),
    filesystem: overrides?.filesystem ?? new MockFilesystem(),
    config: overrides?.config ?? { wodHome: "/home/user/wod" },
  };
}

describe("downInstance", () => {
  test("returns exit code 1 when instance directory does not exist", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/other");
    const deps = createDeps({ filesystem: fs });
    const result = downInstance(deps, "nonexistent");
    expect(result.exitCode).toBe(1);
  });

  test("runs docker compose down in instance directory", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "compose", "down"], { exitCode: 0 });

    const deps = createDeps({ processRunner: runner });
    downInstance(deps, "mysite");

    const composeCall = runner.recordedCalls.find(
      (c) => c.command[0] === "docker" && c.command[1] === "compose",
    );
    expect(composeCall).toBeDefined();
    expect(composeCall?.command).toEqual(["docker", "compose", "down"]);
    expect(composeCall?.options?.cwd).toBe("/home/user/wod/mysite");
  });

  test("returns exit code 0 on success", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "compose", "down"], { exitCode: 0 });

    const deps = createDeps({ processRunner: runner });
    const result = downInstance(deps, "mysite");

    expect(result.exitCode).toBe(0);
  });

  test("passes through docker compose exit code on failure", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "compose", "down"], {
      exitCode: 3,
      stderr: "compose error",
    });

    const deps = createDeps({ processRunner: runner });
    const result = downInstance(deps, "mysite");

    expect(result.exitCode).toBe(3);
  });

  test("does not run docker compose when directory is missing", () => {
    const runner = new MockProcessRunner();
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/other");

    const deps = createDeps({ processRunner: runner, filesystem: fs });
    downInstance(deps, "nonexistent");

    expect(runner.calls).toHaveLength(0);
  });
});
