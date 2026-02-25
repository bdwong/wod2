import { describe, expect, test } from "bun:test";
import type { CreateConfig } from "../config/create-config.ts";
import { buildTemplateVars } from "./template-vars.ts";

const defaultConfig: CreateConfig = {
  wordpressVersion: "6.7.1",
  phpVersion: "8.2",
  mysqlVersion: "5.7",
  templateName: "php8.2",
  httpPort: 8000,
  httpsPort: 8443,
  siteUrl: "http://127.0.0.1:8000",
};

describe("buildTemplateVars", () => {
  test("returns all config values", () => {
    const vars = buildTemplateVars(defaultConfig);
    expect(vars.wordpressVersion).toBe("6.7.1");
    expect(vars.phpVersion).toBe("8.2");
    expect(vars.mysqlVersion).toBe("5.7");
  });

  test("computes wordpressTag from version and PHP version", () => {
    const vars = buildTemplateVars(defaultConfig);
    expect(vars.wordpressTag).toBe("6.7.1-php8.2-apache");
  });

  test("computes wordpressCustomImageTag from version and PHP version", () => {
    const vars = buildTemplateVars(defaultConfig);
    expect(vars.wordpressCustomImageTag).toBe("6.7.1-php8.2-custom");
  });

  test("uses custom versions", () => {
    const config: CreateConfig = {
      ...defaultConfig,
      wordpressVersion: "5.9",
      phpVersion: "7.4",
      mysqlVersion: "8.0",
    };
    const vars = buildTemplateVars(config);
    expect(vars.wordpressTag).toBe("5.9-php7.4-apache");
    expect(vars.wordpressCustomImageTag).toBe("5.9-php7.4-custom");
    expect(vars.mysqlVersion).toBe("8.0");
  });

  test("PHP 7.1: phpGdLegacy=true, phpMcryptAvailable=true, phpAvifSupported=false", () => {
    const vars = buildTemplateVars({ ...defaultConfig, phpVersion: "7.1" });
    expect(vars.phpGdLegacy).toBe(true);
    expect(vars.phpMcryptAvailable).toBe(true);
    expect(vars.phpAvifSupported).toBe(false);
  });

  test("PHP 7.4: phpGdLegacy=false, phpMcryptAvailable=false, phpAvifSupported=false", () => {
    const vars = buildTemplateVars({ ...defaultConfig, phpVersion: "7.4" });
    expect(vars.phpGdLegacy).toBe(false);
    expect(vars.phpMcryptAvailable).toBe(false);
    expect(vars.phpAvifSupported).toBe(false);
  });

  test("PHP 8.0: phpGdLegacy=false, phpMcryptAvailable=false, phpAvifSupported=false", () => {
    const vars = buildTemplateVars({ ...defaultConfig, phpVersion: "8.0" });
    expect(vars.phpGdLegacy).toBe(false);
    expect(vars.phpMcryptAvailable).toBe(false);
    expect(vars.phpAvifSupported).toBe(false);
  });

  test("PHP 8.1: phpGdLegacy=false, phpMcryptAvailable=false, phpAvifSupported=true", () => {
    const vars = buildTemplateVars({ ...defaultConfig, phpVersion: "8.1" });
    expect(vars.phpGdLegacy).toBe(false);
    expect(vars.phpMcryptAvailable).toBe(false);
    expect(vars.phpAvifSupported).toBe(true);
  });

  test("PHP 8.2 (default): phpGdLegacy=false, phpMcryptAvailable=false, phpAvifSupported=true", () => {
    const vars = buildTemplateVars(defaultConfig);
    expect(vars.phpGdLegacy).toBe(false);
    expect(vars.phpMcryptAvailable).toBe(false);
    expect(vars.phpAvifSupported).toBe(true);
  });
});
