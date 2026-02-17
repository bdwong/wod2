import { describe, expect, test } from "bun:test";
import { MockProcessRunner } from "../docker/mock-process-runner.ts";
import { MockFilesystem } from "../utils/mock-filesystem.ts";
import type { LsDependencies } from "./ls.ts";
import { listInstances } from "./ls.ts";

function createDeps(overrides?: Partial<LsDependencies>): LsDependencies {
  return {
    processRunner: overrides?.processRunner ?? new MockProcessRunner(),
    filesystem: overrides?.filesystem ?? new MockFilesystem(),
    config: overrides?.config ?? { wodHome: "/home/user/wod" },
  };
}

describe("listInstances", () => {
  test("returns empty instances when WOD_HOME has no subdirectories", () => {
    const deps = createDeps();
    const result = listInstances(deps);
    expect(result.instances).toEqual([]);
  });

  test("calls ensureDirectory on WOD_HOME", () => {
    const fs = new MockFilesystem();
    const deps = createDeps({ filesystem: fs });
    listInstances(deps);
    expect(fs.ensuredDirs).toContain("/home/user/wod");
  });

  test("returns dockerRunning false when no instances exist", () => {
    const deps = createDeps();
    const result = listInstances(deps);
    // When no instances, we don't check Docker, so dockerRunning can be false
    expect(result.dockerRunning).toBe(false);
  });

  test("checks Docker status when instances exist", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "version"], { exitCode: 0 });
    // Container checks will return no matches
    runner.addResponse(["docker", "container", "ls", "-qf"], { exitCode: 0, stdout: "" });

    const fs = new MockFilesystem();
    fs.setSubdirectories("/home/user/wod", ["mysite"]);

    const deps = createDeps({ processRunner: runner, filesystem: fs });
    const result = listInstances(deps);
    expect(result.dockerRunning).toBe(true);
  });

  test("marks all instances as not running when Docker is down", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "version"], { exitCode: 1 });

    const fs = new MockFilesystem();
    fs.setSubdirectories("/home/user/wod", ["site-a", "site-b"]);

    const deps = createDeps({ processRunner: runner, filesystem: fs });
    const result = listInstances(deps);

    expect(result.dockerRunning).toBe(false);
    expect(result.instances).toHaveLength(2);
    expect(result.instances[0]).toEqual({
      name: "site-a",
      dbRunning: false,
      wpRunning: false,
      siteUrl: null,
    });
    expect(result.instances[1]).toEqual({
      name: "site-b",
      dbRunning: false,
      wpRunning: false,
      siteUrl: null,
    });
  });

  test("detects running containers and queries siteurl", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "version"], { exitCode: 0 });

    // Container checks for "active" — both running
    runner.addResponse(["docker", "container", "ls", "-qf", "name=active-db-"], {
      exitCode: 0,
      stdout: "db123\n",
    });
    runner.addResponse(["docker", "container", "ls", "-qf", "name=active-wordpress-"], {
      exitCode: 0,
      stdout: "wp456\n",
    });
    // querySiteUrl chain for "active"
    // (querySiteUrl does its own container ls, env, and run calls)
    runner.addResponse(["docker", "exec"], {
      exitCode: 0,
      stdout: "WORDPRESS_DB_HOST=db:3306\n",
    });
    runner.addResponse(["docker", "run"], {
      exitCode: 0,
      stdout: "http://127.0.0.1:8000\n",
    });

    const fs = new MockFilesystem();
    fs.setSubdirectories("/home/user/wod", ["active"]);

    const deps = createDeps({ processRunner: runner, filesystem: fs });
    const result = listInstances(deps);

    expect(result.instances).toHaveLength(1);
    expect(result.instances[0].name).toBe("active");
    expect(result.instances[0].dbRunning).toBe(true);
    expect(result.instances[0].wpRunning).toBe(true);
    expect(result.instances[0].siteUrl).toBe("http://127.0.0.1:8000");
  });

  test("does not query siteurl when containers are stopped", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "version"], { exitCode: 0 });
    runner.addResponse(["docker", "container", "ls", "-qf", "name=stopped-db-"], {
      exitCode: 0,
      stdout: "",
    });
    runner.addResponse(["docker", "container", "ls", "-qf", "name=stopped-wordpress-"], {
      exitCode: 0,
      stdout: "",
    });

    const fs = new MockFilesystem();
    fs.setSubdirectories("/home/user/wod", ["stopped"]);

    const deps = createDeps({ processRunner: runner, filesystem: fs });
    const result = listInstances(deps);

    expect(result.instances[0]).toEqual({
      name: "stopped",
      dbRunning: false,
      wpRunning: false,
      siteUrl: null,
    });
    // Should not have made any docker exec or docker run calls
    const nonLsCalls = runner.calls.filter(
      (c) => !(c[0] === "docker" && (c[1] === "version" || c[1] === "container")),
    );
    expect(nonLsCalls).toHaveLength(0);
  });
});
