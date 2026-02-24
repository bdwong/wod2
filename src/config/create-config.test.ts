import { afterEach, describe, expect, test } from "bun:test";
import { resolveCreateConfig, wordpressCustomImageTag, wordpressTag } from "./create-config.ts";

describe("resolveCreateConfig", () => {
  const envVars = [
    "WORDPRESS_VERSION",
    "PHP_VERSION",
    "MYSQL_VERSION",
    "TEMPLATE_NAME",
    "SITEURL",
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of envVars) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  function clearEnvVars(): void {
    for (const key of envVars) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  }

  test("returns defaults when no overrides or env vars", () => {
    clearEnvVars();
    const config = resolveCreateConfig();
    expect(config).toEqual({
      wordpressVersion: "6.7.1",
      phpVersion: "8.2",
      mysqlVersion: "5.7",
      templateName: "php8.2",
      siteUrl: "https://127.0.0.1:8443",
    });
  });

  test("reads WORDPRESS_VERSION from env", () => {
    clearEnvVars();
    process.env.WORDPRESS_VERSION = "5.9";
    const config = resolveCreateConfig();
    expect(config.wordpressVersion).toBe("5.9");
  });

  test("reads PHP_VERSION from env", () => {
    clearEnvVars();
    process.env.PHP_VERSION = "7.4";
    const config = resolveCreateConfig();
    expect(config.phpVersion).toBe("7.4");
  });

  test("reads MYSQL_VERSION from env", () => {
    clearEnvVars();
    process.env.MYSQL_VERSION = "8.0";
    const config = resolveCreateConfig();
    expect(config.mysqlVersion).toBe("8.0");
  });

  test("reads TEMPLATE_NAME from env", () => {
    clearEnvVars();
    process.env.TEMPLATE_NAME = "php7.4";
    const config = resolveCreateConfig();
    expect(config.templateName).toBe("php7.4");
  });

  test("reads SITEURL from env", () => {
    clearEnvVars();
    process.env.SITEURL = "http://127.0.0.1:9000";
    const config = resolveCreateConfig();
    expect(config.siteUrl).toBe("http://127.0.0.1:9000");
  });

  test("overrides take precedence over env vars", () => {
    clearEnvVars();
    process.env.WORDPRESS_VERSION = "5.9";
    process.env.PHP_VERSION = "7.4";
    const config = resolveCreateConfig({
      wordpressVersion: "6.0",
      phpVersion: "8.1",
    });
    expect(config.wordpressVersion).toBe("6.0");
    expect(config.phpVersion).toBe("8.1");
  });

  test("partial overrides merge with defaults", () => {
    clearEnvVars();
    const config = resolveCreateConfig({ siteUrl: "http://localhost:3000" });
    expect(config.siteUrl).toBe("http://localhost:3000");
    expect(config.wordpressVersion).toBe("6.7.1");
    expect(config.phpVersion).toBe("8.2");
  });
});

describe("wordpressTag", () => {
  test("computes tag from config", () => {
    const tag = wordpressTag({
      wordpressVersion: "6.7.1",
      phpVersion: "8.2",
      mysqlVersion: "5.7",
      templateName: "php8.2",
      siteUrl: "",
    });
    expect(tag).toBe("6.7.1-php8.2-apache");
  });

  test("uses custom versions", () => {
    const tag = wordpressTag({
      wordpressVersion: "5.9",
      phpVersion: "7.4",
      mysqlVersion: "5.7",
      templateName: "php7.4",
      siteUrl: "",
    });
    expect(tag).toBe("5.9-php7.4-apache");
  });
});

describe("wordpressCustomImageTag", () => {
  test("computes custom image tag from config", () => {
    const tag = wordpressCustomImageTag({
      wordpressVersion: "6.7.1",
      phpVersion: "8.2",
      mysqlVersion: "5.7",
      templateName: "php8.2",
      siteUrl: "",
    });
    expect(tag).toBe("6.7.1-php8.2-custom");
  });
});
