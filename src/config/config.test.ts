import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { configResolver, configTree, loaders, targetDir } from "./config.ts";

function resolveConfig(): ReturnType<typeof configResolver.resolveConfig> {
  return configResolver.resolveConfig(configTree, loaders);
}

describe("resolveConfig", () => {
  let originalWodHome: string | undefined;

  beforeEach(() => {
    originalWodHome = process.env.WOD_HOME;
  });

  afterEach(() => {
    if (originalWodHome === undefined) {
      delete process.env.WOD_HOME;
    } else {
      process.env.WOD_HOME = originalWodHome;
    }
  });

  test("defaults wodHome to ~/wod", () => {
    delete process.env.WOD_HOME;
    const config = resolveConfig();
    expect(config.wodHome).toBe(path.join(os.homedir(), "wod"));
  });

  test("reads WOD_HOME from environment", () => {
    process.env.WOD_HOME = "/tmp/custom-wod";
    const config = resolveConfig();
    expect(config.wodHome).toBe("/tmp/custom-wod");
  });
});

describe("config file loading", () => {
  const configDir = path.join(os.homedir(), ".wod");
  const configFile = path.join(configDir, "config.json");
  let savedContent: string | null = null;
  let originalWodHome: string | undefined;

  function saveExisting(): void {
    originalWodHome = process.env.WOD_HOME;
    try {
      savedContent = fs.readFileSync(configFile, "utf-8");
    } catch {
      savedContent = null;
    }
  }

  afterEach(() => {
    if (savedContent !== null) {
      fs.writeFileSync(configFile, savedContent);
    } else {
      try {
        fs.unlinkSync(configFile);
      } catch {
        // File didn't exist before
      }
    }
    savedContent = null;
    if (originalWodHome === undefined) {
      delete process.env.WOD_HOME;
    } else {
      process.env.WOD_HOME = originalWodHome;
    }
  });

  test("reads wodHome from config file", () => {
    saveExisting();
    delete process.env.WOD_HOME;
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify({ wodHome: "/tmp/from-config" }));
    const config = resolveConfig();
    expect(config.wodHome).toBe("/tmp/from-config");
  });

  test("env var overrides config file", () => {
    saveExisting();
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify({ wodHome: "/tmp/from-config" }));
    process.env.WOD_HOME = "/tmp/from-env";
    const config = resolveConfig();
    expect(config.wodHome).toBe("/tmp/from-env");
  });

  test("missing config file is handled gracefully", () => {
    saveExisting();
    delete process.env.WOD_HOME;
    try {
      fs.unlinkSync(configFile);
    } catch {
      // Already doesn't exist
    }
    const config = resolveConfig();
    expect(config.wodHome).toBe(path.join(os.homedir(), "wod"));
  });
});

describe("targetDir", () => {
  test("joins wodHome with instance name", () => {
    expect(targetDir({ wodHome: "/home/user/wod" }, "mysite")).toBe("/home/user/wod/mysite");
  });
});
