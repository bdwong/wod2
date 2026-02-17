import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { resolveConfig, targetDir } from "./config.ts";

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

  test("explicit override takes precedence over environment", () => {
    process.env.WOD_HOME = "/tmp/env-wod";
    const config = resolveConfig({ wodHome: "/tmp/override-wod" });
    expect(config.wodHome).toBe("/tmp/override-wod");
  });
});

describe("targetDir", () => {
  test("joins wodHome with instance name", () => {
    const config = resolveConfig({ wodHome: "/home/user/wod" });
    expect(targetDir(config, "mysite")).toBe("/home/user/wod/mysite");
  });
});
