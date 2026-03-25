import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveConfigForCreate, wordpressCustomImageTag, wordpressTag } from "./create-config.ts";

describe("resolveConfigForCreate", () => {
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
    const config = resolveConfigForCreate();
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
    const config = resolveConfigForCreate();
    expect(config.wordpressVersion).toBe("5.9");
  });

  test("reads PHP_VERSION from env", () => {
    clearEnvVars();
    process.env.PHP_VERSION = "7.4";
    const config = resolveConfigForCreate();
    expect(config.phpVersion).toBe("7.4");
  });

  test("reads MYSQL_VERSION from env", () => {
    clearEnvVars();
    process.env.MYSQL_VERSION = "8.0";
    const config = resolveConfigForCreate();
    expect(config.mysqlVersion).toBe("8.0");
  });

  test("reads TEMPLATE_NAME from env", () => {
    clearEnvVars();
    process.env.TEMPLATE_NAME = "php7.4";
    const config = resolveConfigForCreate();
    expect(config.templateName).toBe("php7.4");
  });

  test("reads HTTP_PORT from env", () => {
    clearEnvVars();
    process.env.HTTP_PORT = "9080";
    const config = resolveConfigForCreate();
    expect(config.httpPort).toBe(9080);
  });

  test("reads HTTPS_PORT from env", () => {
    clearEnvVars();
    process.env.HTTPS_PORT = "9443";
    const config = resolveConfigForCreate();
    expect(config.httpsPort).toBe(9443);
  });

  test("derives siteUrl from httpsPort", () => {
    clearEnvVars();
    process.env.HTTPS_PORT = "9443";
    const config = resolveConfigForCreate();
    expect(config.siteUrl).toBe("https://127.0.0.1:9443");
  });

  test("reads SITEURL from env", () => {
    clearEnvVars();
    process.env.SITEURL = "http://127.0.0.1:9000";
    const config = resolveConfigForCreate();
    expect(config.siteUrl).toBe("http://127.0.0.1:9000");
  });

  test("overrides take precedence over env vars", () => {
    clearEnvVars();
    process.env.WORDPRESS_VERSION = "5.9";
    process.env.PHP_VERSION = "7.4";
    const config = resolveConfigForCreate({
      wordpressVersion: "6.0",
      phpVersion: "8.1",
    });
    expect(config.wordpressVersion).toBe("6.0");
    expect(config.phpVersion).toBe("8.1");
  });

  test("partial overrides merge with defaults", () => {
    clearEnvVars();
    const config = resolveConfigForCreate({ siteUrl: "http://localhost:3000" });
    expect(config.siteUrl).toBe("http://localhost:3000");
    expect(config.wordpressVersion).toBe("6.9.1");
    expect(config.phpVersion).toBe("8.5");
  });

  test("reads HOSTNAMES from env as comma-separated list", () => {
    clearEnvVars();
    process.env.HOSTNAMES = "mysite.local,alt.local";
    const config = resolveConfigForCreate();
    expect(config.hostnames).toEqual(["mysite.local", "alt.local"]);
  });

  test("derives siteUrl from first hostname when hostnames provided", () => {
    clearEnvVars();
    const config = resolveConfigForCreate({ hostnames: ["mysite.local", "alt.local"] });
    expect(config.siteUrl).toBe("https://mysite.local:8443");
  });

  test("derives siteUrl from first hostname with custom httpsPort", () => {
    clearEnvVars();
    const config = resolveConfigForCreate({ hostnames: ["mysite.local"], httpsPort: 9443 });
    expect(config.siteUrl).toBe("https://mysite.local:9443");
  });

  test("explicit siteUrl takes precedence over hostnames", () => {
    clearEnvVars();
    const config = resolveConfigForCreate({
      hostnames: ["mysite.local"],
      siteUrl: "http://custom:3000",
    });
    expect(config.siteUrl).toBe("http://custom:3000");
  });

  test("hostnames override takes precedence over HOSTNAMES env", () => {
    clearEnvVars();
    process.env.HOSTNAMES = "env.local";
    const config = resolveConfigForCreate({ hostnames: ["override.local"] });
    expect(config.hostnames).toEqual(["override.local"]);
  });

  test("defaults to empty hostnames when no overrides or env", () => {
    clearEnvVars();
    const config = resolveConfigForCreate();
    expect(config.hostnames).toEqual([]);
  });
});

describe("config file loading", () => {
  const configDir = path.join(os.homedir(), ".wod");
  const configFile = path.join(configDir, "config.json");
  let savedContent: string | null = null;

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

  function clearEnvVars(): void {
    for (const key of envVars) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  }

  function writeConfig(content: object): void {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify(content));
  }

  afterEach(() => {
    // Restore config file
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
    // Restore env vars
    for (const key of envVars) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  function saveExisting(): void {
    try {
      savedContent = fs.readFileSync(configFile, "utf-8");
    } catch {
      savedContent = null;
    }
  }

  test("reads values from config file", () => {
    clearEnvVars();
    saveExisting();
    writeConfig({ phpVersion: "8.4", httpsPort: 9443 });
    const config = resolveConfigForCreate();
    expect(config.phpVersion).toBe("8.4");
    expect(config.httpsPort).toBe(9443);
  });

  test("config file values are overridden by env vars", () => {
    clearEnvVars();
    saveExisting();
    writeConfig({ phpVersion: "8.4" });
    process.env.PHP_VERSION = "8.3";
    const config = resolveConfigForCreate();
    expect(config.phpVersion).toBe("8.3");
  });

  test("config file values are overridden by programmatic overrides", () => {
    clearEnvVars();
    saveExisting();
    writeConfig({ phpVersion: "8.4" });
    const config = resolveConfigForCreate({ phpVersion: "8.2" });
    expect(config.phpVersion).toBe("8.2");
  });

  test("missing config file is handled gracefully", () => {
    clearEnvVars();
    saveExisting();
    try {
      fs.unlinkSync(configFile);
    } catch {
      // Already doesn't exist
    }
    const config = resolveConfigForCreate();
    expect(config.phpVersion).toBe("8.5"); // default
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
