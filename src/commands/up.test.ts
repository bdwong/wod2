import { describe, expect, test } from "bun:test";
import { MockProcessRunner } from "../docker/mock-process-runner.ts";
import { MockFilesystem } from "../utils/mock-filesystem.ts";
import { type UpDependencies, upInstance } from "./up.ts";

function createDeps(overrides?: Partial<UpDependencies>): UpDependencies {
  return {
    processRunner: overrides?.processRunner ?? new MockProcessRunner(),
    filesystem: overrides?.filesystem ?? new MockFilesystem(),
    config: overrides?.config ?? { wodHome: "/home/user/wod" },
  };
}

describe("upInstance", () => {
  test("returns exit code 1 when instance directory does not exist", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/other");
    const deps = createDeps({ filesystem: fs });
    const result = upInstance(deps, "nonexistent");
    expect(result.exitCode).toBe(1);
    expect(result.siteUrl).toBeNull();
  });

  test("runs docker compose up -d in instance directory", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "compose", "up", "-d"], { exitCode: 0 });
    // querySiteUrl calls
    runner.addResponse(["docker", "container", "ls", "-qf"], {
      exitCode: 0,
      stdout: "abc123\n",
    });
    runner.addResponse(["docker", "exec"], {
      exitCode: 0,
      stdout: "WORDPRESS_DB_HOST=db:3306\n",
    });
    runner.addResponse(["docker", "run"], {
      exitCode: 0,
      stdout: "http://127.0.0.1:8080\n",
    });

    const deps = createDeps({ processRunner: runner });
    upInstance(deps, "mysite");

    const composeCall = runner.recordedCalls.find(
      (c) => c.command[0] === "docker" && c.command[1] === "compose",
    );
    expect(composeCall).toBeDefined();
    expect(composeCall?.command).toEqual(["docker", "compose", "up", "-d"]);
    expect(composeCall?.options?.cwd).toBe("/home/user/wod/mysite");
  });

  test("returns site URL on success", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "compose", "up", "-d"], { exitCode: 0 });
    runner.addResponse(["docker", "container", "ls", "-qf"], {
      exitCode: 0,
      stdout: "abc123\n",
    });
    runner.addResponse(["docker", "exec"], {
      exitCode: 0,
      stdout: "WORDPRESS_DB_HOST=db:3306\n",
    });
    runner.addResponse(["docker", "run"], {
      exitCode: 0,
      stdout: "http://127.0.0.1:8080\n",
    });

    const deps = createDeps({ processRunner: runner });
    const result = upInstance(deps, "mysite");

    expect(result.exitCode).toBe(0);
    expect(result.siteUrl).toBe("http://127.0.0.1:8080");
  });

  test("passes through docker compose exit code on failure", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "compose", "up", "-d"], {
      exitCode: 2,
      stderr: "compose error",
    });

    const deps = createDeps({ processRunner: runner });
    const result = upInstance(deps, "mysite");

    expect(result.exitCode).toBe(2);
    expect(result.siteUrl).toBeNull();
  });

  test("does not query site URL when docker compose fails", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "compose", "up", "-d"], { exitCode: 1 });

    const deps = createDeps({ processRunner: runner });
    upInstance(deps, "mysite");

    // Only the docker compose call should have been made
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]).toEqual(["docker", "compose", "up", "-d"]);
  });

  test("writes .env file when ports are provided", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "compose", "up", "-d"], { exitCode: 0 });
    runner.addResponse(["docker", "container", "ls", "-qf"], { exitCode: 0, stdout: "abc123\n" });
    runner.addResponse(["docker", "exec"], { exitCode: 0, stdout: "WORDPRESS_DB_HOST=db:3306\n" });
    runner.addResponse(["docker", "run"], { exitCode: 0, stdout: "http://127.0.0.1:9080\n" });

    const fs = new MockFilesystem();
    const deps = createDeps({ processRunner: runner, filesystem: fs });
    upInstance(deps, "mysite", { httpPort: 9080, httpsPort: 9443 });

    const envFile = fs.writtenFiles.get("/home/user/wod/mysite/.env");
    expect(envFile).toBeDefined();
    expect(envFile).toContain("HTTP_PORT=9080");
    expect(envFile).toContain("HTTPS_PORT=9443");
  });

  test("does not write .env file when ports are not provided", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "compose", "up", "-d"], { exitCode: 0 });
    runner.addResponse(["docker", "container", "ls", "-qf"], { exitCode: 0, stdout: "abc123\n" });
    runner.addResponse(["docker", "exec"], { exitCode: 0, stdout: "WORDPRESS_DB_HOST=db:3306\n" });
    runner.addResponse(["docker", "run"], { exitCode: 0, stdout: "http://127.0.0.1:8080\n" });

    const fs = new MockFilesystem();
    const deps = createDeps({ processRunner: runner, filesystem: fs });
    upInstance(deps, "mysite");

    expect(fs.writtenFiles.has("/home/user/wod/mysite/.env")).toBe(false);
  });

  test("returns null siteUrl when querySiteUrl fails", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "compose", "up", "-d"], { exitCode: 0 });
    runner.addResponse(["docker", "container", "ls", "-qf"], {
      exitCode: 0,
      stdout: "",
    });

    const deps = createDeps({ processRunner: runner });
    const result = upInstance(deps, "mysite");

    expect(result.exitCode).toBe(0);
    expect(result.siteUrl).toBeNull();
  });
});
