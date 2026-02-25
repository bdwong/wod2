import { describe, expect, test } from "bun:test";
import type { CreateConfig } from "../config/create-config.ts";
import { MockProcessRunner } from "../docker/mock-process-runner.ts";
import { BUNDLED_TEMPLATES } from "../templates/bundled-templates.ts";
import { BundledTemplateSource } from "../templates/template-engine.ts";
import { MockFilesystem } from "../utils/mock-filesystem.ts";
import { type UpdateDependencies, updateInstance } from "./update.ts";

const defaultCreateConfig: CreateConfig = {
  wordpressVersion: "6.7.1",
  phpVersion: "8.2",
  mysqlVersion: "5.7",
  templateName: "php8.2",
  httpPort: 8000,
  httpsPort: 8443,
  siteUrl: "https://127.0.0.1:8443",
};

function createDeps(overrides?: Partial<UpdateDependencies>): UpdateDependencies {
  return {
    processRunner: overrides?.processRunner ?? new MockProcessRunner(),
    filesystem: overrides?.filesystem ?? new MockFilesystem(),
    config: overrides?.config ?? { wodHome: "/home/user/wod" },
    createConfig: overrides?.createConfig ?? defaultCreateConfig,
    templateSource: overrides?.templateSource ?? new BundledTemplateSource(BUNDLED_TEMPLATES),
  };
}

function setupSuccessRunner(): MockProcessRunner {
  const runner = new MockProcessRunner();
  runner.addResponse(["docker", "compose", "down"], { exitCode: 0 });
  runner.addResponse(["docker", "compose", "up", "--build", "-d"], { exitCode: 0 });
  return runner;
}

describe("updateInstance", () => {
  test("returns error when instance directory does not exist", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/other");
    const deps = createDeps({ filesystem: fs });
    const result = updateInstance(deps, "nonexistent");
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Instance directory does not exist");
  });

  test("does not run docker commands when directory is missing", () => {
    const runner = new MockProcessRunner();
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/other");
    const deps = createDeps({ processRunner: runner, filesystem: fs });
    updateInstance(deps, "nonexistent");
    expect(runner.calls).toHaveLength(0);
  });

  test("runs docker compose down before rebuilding", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/mysite");
    const runner = setupSuccessRunner();
    const deps = createDeps({ processRunner: runner, filesystem: fs });
    updateInstance(deps, "mysite");

    const downCall = runner.recordedCalls.find((c) => c.command.includes("down"));
    expect(downCall).toBeDefined();
    expect(downCall?.command).toEqual(["docker", "compose", "down"]);
    expect(downCall?.options?.cwd).toBe("/home/user/wod/mysite");
  });

  test("re-renders template files", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/mysite");
    const runner = setupSuccessRunner();
    const deps = createDeps({ processRunner: runner, filesystem: fs });
    updateInstance(deps, "mysite");

    const compose = fs.writtenFiles.get("/home/user/wod/mysite/docker-compose.yml");
    expect(compose).toBeDefined();
    expect(compose).toContain("image: mysql:5.7");

    const dockerfile = fs.writtenFiles.get("/home/user/wod/mysite/wp-php-custom/Dockerfile");
    expect(dockerfile).toBeDefined();
    expect(dockerfile).toContain("FROM wordpress:6.7.1-php8.2-apache");
  });

  test("rebuilds with --build flag", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/mysite");
    const runner = setupSuccessRunner();
    const deps = createDeps({ processRunner: runner, filesystem: fs });
    updateInstance(deps, "mysite");

    const upCall = runner.recordedCalls.find((c) => c.command.includes("up"));
    expect(upCall).toBeDefined();
    expect(upCall?.command).toEqual(["docker", "compose", "up", "--build", "-d"]);
    expect(upCall?.options?.cwd).toBe("/home/user/wod/mysite");
  });

  test("stops containers before re-rendering templates", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/mysite");
    const runner = setupSuccessRunner();
    const deps = createDeps({ processRunner: runner, filesystem: fs });
    updateInstance(deps, "mysite");

    const downIndex = runner.recordedCalls.findIndex((c) => c.command.includes("down"));
    const upIndex = runner.recordedCalls.findIndex((c) => c.command.includes("up"));
    expect(downIndex).toBeLessThan(upIndex);
  });

  test("returns error when docker compose down fails", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/mysite");
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "compose", "down"], { exitCode: 2, stderr: "down error" });
    const deps = createDeps({ processRunner: runner, filesystem: fs });
    const result = updateInstance(deps, "mysite");
    expect(result.exitCode).toBe(2);
    expect(result.error).toContain("docker compose down failed");
  });

  test("returns error when docker compose up fails", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/mysite");
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "compose", "down"], { exitCode: 0 });
    runner.addResponse(["docker", "compose", "up", "--build", "-d"], {
      exitCode: 1,
      stderr: "build error",
    });
    const deps = createDeps({ processRunner: runner, filesystem: fs });
    const result = updateInstance(deps, "mysite");
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("docker compose up failed");
  });

  test("returns exit code 0 with site URL on success", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/mysite");
    const runner = setupSuccessRunner();
    const deps = createDeps({ processRunner: runner, filesystem: fs });
    const result = updateInstance(deps, "mysite");
    expect(result.exitCode).toBe(0);
    expect(result.siteUrl).toBe("https://127.0.0.1:8443");
    expect(result.error).toBeNull();
  });

  test("does not overwrite .env file", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/mysite");
    const runner = setupSuccessRunner();
    const deps = createDeps({ processRunner: runner, filesystem: fs });
    updateInstance(deps, "mysite");

    // installTemplate only writes template files; .env is not part of any template
    const envFile = fs.writtenFiles.get("/home/user/wod/mysite/.env");
    expect(envFile).toBeUndefined();
  });

  test("uses updated versions in re-rendered template files", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/mysite");
    const runner = setupSuccessRunner();
    const updatedConfig: CreateConfig = {
      wordpressVersion: "6.7.1",
      phpVersion: "8.4",
      mysqlVersion: "5.7",
      templateName: "php8.2",
      httpPort: 8000,
      httpsPort: 8443,
      siteUrl: "https://127.0.0.1:8443",
    };
    const deps = createDeps({ processRunner: runner, filesystem: fs, createConfig: updatedConfig });
    updateInstance(deps, "mysite");

    const dockerfile = fs.writtenFiles.get("/home/user/wod/mysite/wp-php-custom/Dockerfile");
    expect(dockerfile).toContain("FROM wordpress:6.7.1-php8.4-apache");
  });
});
