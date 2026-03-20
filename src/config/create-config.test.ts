import { afterEach, describe, expect, test } from "bun:test";
import { resolveCreateConfig, wordpressCustomImageTag, wordpressTag } from "./create-config.ts";

describe("resolveCreateConfig", () => {
  const envVars = [
    "WORDPRESS_VERSION",
    "PHP_VERSION",
    "MYSQL_VERSION",
    "TEMPLATE_NAME",
    "HTTP_PORT",
    "HTTPS_PORT",
    "SITEURL",
    "HOSTNAMES",
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
      wordpressVersion: "6.9.1",
      phpVersion: "8.5",
      mysqlVersion: "5.7",
      templateName: "custom",
      httpPort: 8000,
      httpsPort: 8443,
      siteUrl: "https://127.0.0.1:8443",
      hostnames: [],
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

  test("reads HTTP_PORT from env", () => {
    clearEnvVars();
    process.env.HTTP_PORT = "9080";
    const config = resolveCreateConfig();
    expect(config.httpPort).toBe(9080);
  });

  test("reads HTTPS_PORT from env", () => {
    clearEnvVars();
    process.env.HTTPS_PORT = "9443";
    const config = resolveCreateConfig();
    expect(config.httpsPort).toBe(9443);
  });

  test("derives siteUrl from httpsPort", () => {
    clearEnvVars();
    process.env.HTTPS_PORT = "9443";
    const config = resolveCreateConfig();
    expect(config.siteUrl).toBe("https://127.0.0.1:9443");
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
    expect(config.wordpressVersion).toBe("6.9.1");
    expect(config.phpVersion).toBe("8.5");
  });

  test("reads HOSTNAMES from env as comma-separated list", () => {
    clearEnvVars();
    process.env.HOSTNAMES = "mysite.local,alt.local";
    const config = resolveCreateConfig();
    expect(config.hostnames).toEqual(["mysite.local", "alt.local"]);
  });

  test("derives siteUrl from first hostname when hostnames provided", () => {
    clearEnvVars();
    const config = resolveCreateConfig({ hostnames: ["mysite.local", "alt.local"] });
    expect(config.siteUrl).toBe("https://mysite.local:8443");
  });

  test("derives siteUrl from first hostname with custom httpsPort", () => {
    clearEnvVars();
    const config = resolveCreateConfig({ hostnames: ["mysite.local"], httpsPort: 9443 });
    expect(config.siteUrl).toBe("https://mysite.local:9443");
  });

  test("explicit siteUrl takes precedence over hostnames", () => {
    clearEnvVars();
    const config = resolveCreateConfig({
      hostnames: ["mysite.local"],
      siteUrl: "http://custom:3000",
    });
    expect(config.siteUrl).toBe("http://custom:3000");
  });

  test("hostnames override takes precedence over HOSTNAMES env", () => {
    clearEnvVars();
    process.env.HOSTNAMES = "env.local";
    const config = resolveCreateConfig({ hostnames: ["override.local"] });
    expect(config.hostnames).toEqual(["override.local"]);
  });

  test("defaults to empty hostnames when no overrides or env", () => {
    clearEnvVars();
    const config = resolveCreateConfig();
    expect(config.hostnames).toEqual([]);
  });
});

describe("wordpressTag", () => {
  test("computes tag from config", () => {
    const tag = wordpressTag({
      wordpressVersion: "6.7.1",
      phpVersion: "8.2",
      mysqlVersion: "5.7",
      templateName: "php8.2",
      httpPort: 8000,
      httpsPort: 8443,
      siteUrl: "",
      hostnames: [],
    });
    expect(tag).toBe("6.7.1-php8.2-apache");
  });

  test("uses custom versions", () => {
    const tag = wordpressTag({
      wordpressVersion: "5.9",
      phpVersion: "7.4",
      mysqlVersion: "5.7",
      templateName: "php7.4",
      httpPort: 8000,
      httpsPort: 8443,
      siteUrl: "",
      hostnames: [],
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
      httpPort: 8000,
      httpsPort: 8443,
      siteUrl: "",
      hostnames: [],
    });
    expect(tag).toBe("6.7.1-php8.2-custom");
  });
});
