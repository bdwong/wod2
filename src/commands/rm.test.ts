import { describe, expect, test } from "bun:test";
import { MockProcessRunner } from "../docker/mock-process-runner.ts";
import { MockFilesystem } from "../utils/mock-filesystem.ts";
import { type RmDependencies, rmInstance } from "./rm.ts";

function createDeps(overrides?: Partial<RmDependencies>): RmDependencies {
  return {
    processRunner: overrides?.processRunner ?? new MockProcessRunner(),
    filesystem: overrides?.filesystem ?? new MockFilesystem(),
    config: overrides?.config ?? { wodHome: "/home/user/wod" },
  };
}

describe("rmInstance", () => {
  test("returns error when instance directory does not exist", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/other");
    const deps = createDeps({ filesystem: fs });
    const result = rmInstance(deps, "mysite");
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Instance directory does not exist");
  });

  test("runs docker compose down when docker-compose.yml exists", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/mysite");
    fs.addFile("/home/user/wod/mysite/docker-compose.yml", "version: '3'");
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "compose", "down"], { exitCode: 0 });
    runner.addResponse(["sudo", "rm", "-rf"], { exitCode: 0 });
    runner.addResponse(["docker", "volume", "ls", "-qf", "name=mysite_db_data"], {
      exitCode: 0,
      stdout: "",
    });
    const deps = createDeps({ processRunner: runner, filesystem: fs });
    rmInstance(deps, "mysite");

    const downCall = runner.recordedCalls.find(
      (c) => c.command[1] === "compose" && c.command[2] === "down",
    );
    expect(downCall).toBeDefined();
    expect(downCall?.options?.cwd).toBe("/home/user/wod/mysite");
  });

  test("skips docker compose down when no docker-compose.yml", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/mysite");
    // No addFile for docker-compose.yml
    const runner = new MockProcessRunner();
    runner.addResponse(["sudo", "rm", "-rf"], { exitCode: 0 });
    runner.addResponse(["docker", "volume", "ls", "-qf", "name=mysite_db_data"], {
      exitCode: 0,
      stdout: "",
    });
    const deps = createDeps({ processRunner: runner, filesystem: fs });
    rmInstance(deps, "mysite");

    const downCall = runner.recordedCalls.find((c) => c.command[1] === "compose");
    expect(downCall).toBeUndefined();
  });

  test("removes instance directory with sudo rm -rf", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/mysite");
    const runner = new MockProcessRunner();
    runner.addResponse(["sudo", "rm", "-rf"], { exitCode: 0 });
    runner.addResponse(["docker", "volume", "ls", "-qf", "name=mysite_db_data"], {
      exitCode: 0,
      stdout: "",
    });
    const deps = createDeps({ processRunner: runner, filesystem: fs });
    rmInstance(deps, "mysite");

    const rmCall = runner.recordedCalls.find(
      (c) => c.command[0] === "sudo" && c.command[1] === "rm",
    );
    expect(rmCall).toBeDefined();
    expect(rmCall?.command).toEqual(["sudo", "rm", "-rf", "/home/user/wod/mysite"]);
  });

  test("removes Docker volume when it exists", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/mysite");
    const runner = new MockProcessRunner();
    runner.addResponse(["sudo", "rm", "-rf"], { exitCode: 0 });
    runner.addResponse(["docker", "volume", "ls", "-qf", "name=mysite_db_data"], {
      exitCode: 0,
      stdout: "mysite_db_data\n",
    });
    runner.addResponse(["docker", "volume", "rm"], { exitCode: 0 });
    const deps = createDeps({ processRunner: runner, filesystem: fs });
    rmInstance(deps, "mysite");

    const volumeRmCall = runner.recordedCalls.find(
      (c) => c.command[0] === "docker" && c.command[1] === "volume" && c.command[2] === "rm",
    );
    expect(volumeRmCall).toBeDefined();
    expect(volumeRmCall?.command).toEqual(["docker", "volume", "rm", "mysite_db_data"]);
  });

  test("skips volume removal when volume does not exist", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/mysite");
    const runner = new MockProcessRunner();
    runner.addResponse(["sudo", "rm", "-rf"], { exitCode: 0 });
    runner.addResponse(["docker", "volume", "ls", "-qf", "name=mysite_db_data"], {
      exitCode: 0,
      stdout: "",
    });
    const deps = createDeps({ processRunner: runner, filesystem: fs });
    rmInstance(deps, "mysite");

    const volumeRmCall = runner.recordedCalls.find(
      (c) => c.command[0] === "docker" && c.command[1] === "volume" && c.command[2] === "rm",
    );
    expect(volumeRmCall).toBeUndefined();
  });

  test("returns error when docker compose down fails", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/mysite");
    fs.addFile("/home/user/wod/mysite/docker-compose.yml", "version: '3'");
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "compose", "down"], { exitCode: 1, stderr: "compose error" });
    const deps = createDeps({ processRunner: runner, filesystem: fs });
    const result = rmInstance(deps, "mysite");
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("docker compose down failed");
  });

  test("returns error when sudo rm fails", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/mysite");
    const runner = new MockProcessRunner();
    runner.addResponse(["sudo", "rm", "-rf"], { exitCode: 1, stderr: "permission denied" });
    const deps = createDeps({ processRunner: runner, filesystem: fs });
    const result = rmInstance(deps, "mysite");
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Failed to remove directory");
  });

  test("returns error when volume removal fails", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/mysite");
    const runner = new MockProcessRunner();
    runner.addResponse(["sudo", "rm", "-rf"], { exitCode: 0 });
    runner.addResponse(["docker", "volume", "ls", "-qf", "name=mysite_db_data"], {
      exitCode: 0,
      stdout: "mysite_db_data\n",
    });
    runner.addResponse(["docker", "volume", "rm"], { exitCode: 1, stderr: "volume in use" });
    const deps = createDeps({ processRunner: runner, filesystem: fs });
    const result = rmInstance(deps, "mysite");
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Failed to remove volume");
  });

  test("returns exit code 0 on full success", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/mysite");
    fs.addFile("/home/user/wod/mysite/docker-compose.yml", "version: '3'");
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "compose", "down"], { exitCode: 0 });
    runner.addResponse(["sudo", "rm", "-rf"], { exitCode: 0 });
    runner.addResponse(["docker", "volume", "ls", "-qf", "name=mysite_db_data"], {
      exitCode: 0,
      stdout: "mysite_db_data\n",
    });
    runner.addResponse(["docker", "volume", "rm"], { exitCode: 0 });
    const deps = createDeps({ processRunner: runner, filesystem: fs });
    const result = rmInstance(deps, "mysite");
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeNull();
  });

  test("does not run docker commands when directory does not exist", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/other");
    const runner = new MockProcessRunner();
    const deps = createDeps({ processRunner: runner, filesystem: fs });
    rmInstance(deps, "mysite");
    expect(runner.calls).toHaveLength(0);
  });
});
