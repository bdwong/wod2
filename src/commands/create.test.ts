import { describe, expect, test } from "bun:test";
import type { CreateConfig } from "../config/create-config.ts";
import { MockProcessRunner } from "../docker/mock-process-runner.ts";
import { BUNDLED_TEMPLATES } from "../templates/bundled-templates.ts";
import { BundledTemplateSource } from "../templates/template-engine.ts";
import { MockFilesystem } from "../utils/mock-filesystem.ts";
import { type CreateDependencies, createInstance } from "./create.ts";

const defaultCreateConfig: CreateConfig = {
  wordpressVersion: "6.7.1",
  phpVersion: "8.2",
  mysqlVersion: "5.7",
  templateName: "php8.2",
  siteUrl: "https://127.0.0.1:8443",
};

function createDeps(overrides?: Partial<CreateDependencies>): CreateDependencies {
  return {
    processRunner: overrides?.processRunner ?? new MockProcessRunner(),
    filesystem: overrides?.filesystem ?? new MockFilesystem(),
    config: overrides?.config ?? { wodHome: "/home/user/wod" },
    createConfig: overrides?.createConfig ?? defaultCreateConfig,
    templateSource: overrides?.templateSource ?? new BundledTemplateSource(BUNDLED_TEMPLATES),
    sleep: overrides?.sleep ?? (async () => {}),
  };
}

/** Sets up a MockProcessRunner that responds successfully to all prerequisite checks and the full create flow. */
function setupSuccessRunner(): MockProcessRunner {
  const runner = new MockProcessRunner();
  // Prerequisite checks: no existing containers or volumes
  runner.addResponse(["docker", "container", "ls", "-aqf", "name=mysite-wordpress-"], {
    exitCode: 0,
    stdout: "",
  });
  runner.addResponse(["docker", "container", "ls", "-aqf", "name=mysite-db-"], {
    exitCode: 0,
    stdout: "",
  });
  runner.addResponse(["docker", "volume", "ls", "-qf", "name=mysite_db_data"], {
    exitCode: 0,
    stdout: "",
  });
  // Generate self-signed TLS certificate
  runner.addResponse(["openssl"], { exitCode: 0 });
  // docker compose up
  runner.addResponse(["docker", "compose", "up", "-d"], { exitCode: 0 });
  // Find WordPress container
  runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
    exitCode: 0,
    stdout: "abc123\n",
  });
  // Extract env vars
  runner.addResponse(["docker", "exec", "abc123", "/bin/env"], {
    exitCode: 0,
    stdout: "WORDPRESS_DB_HOST=db:3306\nWORDPRESS_DB_USER=wordpress\nHOME=/root\n",
  });
  // wp core install
  runner.addResponse(["docker", "run"], {
    exitCode: 0,
    stdout: "Admin password: xK7$m2pQ\nSuccess: WordPress installed.\n",
  });
  return runner;
}

describe("createInstance", () => {
  describe("prerequisite checks", () => {
    test("returns error when target directory already exists", async () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/mysite");
      const deps = createDeps({ filesystem: fs });
      const result = await createInstance(deps, "mysite");
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("Directory already exists");
    });

    test("does not run docker commands when directory already exists", async () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/mysite");
      const runner = new MockProcessRunner();
      const deps = createDeps({ filesystem: fs, processRunner: runner });
      await createInstance(deps, "mysite");
      expect(runner.calls).toHaveLength(0);
    });

    test("returns error when WordPress container already exists", async () => {
      const runner = new MockProcessRunner();
      runner.addResponse(["docker", "container", "ls", "-aqf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      const deps = createDeps({ processRunner: runner, filesystem: fs });
      const result = await createInstance(deps, "mysite");
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("container already exists");
      expect(result.error).toContain("wordpress");
    });

    test("returns error when DB container already exists", async () => {
      const runner = new MockProcessRunner();
      runner.addResponse(["docker", "container", "ls", "-aqf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "",
      });
      runner.addResponse(["docker", "container", "ls", "-aqf", "name=mysite-db-"], {
        exitCode: 0,
        stdout: "def456\n",
      });
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      const deps = createDeps({ processRunner: runner, filesystem: fs });
      const result = await createInstance(deps, "mysite");
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("container already exists");
      expect(result.error).toContain("db");
    });

    test("returns error when volume already exists", async () => {
      const runner = new MockProcessRunner();
      runner.addResponse(["docker", "container", "ls", "-aqf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "",
      });
      runner.addResponse(["docker", "container", "ls", "-aqf", "name=mysite-db-"], {
        exitCode: 0,
        stdout: "",
      });
      runner.addResponse(["docker", "volume", "ls", "-qf", "name=mysite_db_data"], {
        exitCode: 0,
        stdout: "mysite_db_data\n",
      });
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      const deps = createDeps({ processRunner: runner, filesystem: fs });
      const result = await createInstance(deps, "mysite");
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("volume already exists");
    });
  });

  describe("template writing", () => {
    test("creates instance directory and wp-php-custom subdirectory", async () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      const runner = setupSuccessRunner();
      const deps = createDeps({ processRunner: runner, filesystem: fs });
      await createInstance(deps, "mysite");
      expect(fs.ensuredDirs).toContain("/home/user/wod/mysite");
      expect(fs.ensuredDirs).toContain("/home/user/wod/mysite/wp-php-custom");
    });

    test("writes docker-compose.yml with patched versions", async () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      const runner = setupSuccessRunner();
      const deps = createDeps({ processRunner: runner, filesystem: fs });
      await createInstance(deps, "mysite");
      const compose = fs.writtenFiles.get("/home/user/wod/mysite/docker-compose.yml");
      expect(compose).toBeDefined();
      expect(compose).toContain("image: mysql:5.7");
      expect(compose).toContain("image: wordpress:6.7.1-php8.2-custom");
    });

    test("writes Dockerfile with patched FROM line", async () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      const runner = setupSuccessRunner();
      const deps = createDeps({ processRunner: runner, filesystem: fs });
      await createInstance(deps, "mysite");
      const dockerfile = fs.writtenFiles.get("/home/user/wod/mysite/wp-php-custom/Dockerfile");
      expect(dockerfile).toBeDefined();
      expect(dockerfile).toContain("FROM wordpress:6.7.1-php8.2-apache");
    });

    test("writes default.ini", async () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      const runner = setupSuccessRunner();
      const deps = createDeps({ processRunner: runner, filesystem: fs });
      await createInstance(deps, "mysite");
      const ini = fs.writtenFiles.get("/home/user/wod/mysite/wp-php-custom/default.ini");
      expect(ini).toBeDefined();
      expect(ini).toContain("upload_max_filesize=100M");
    });

    test("generates self-signed TLS certificate in wp-php-custom directory", async () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      const runner = setupSuccessRunner();
      const deps = createDeps({ processRunner: runner, filesystem: fs });
      await createInstance(deps, "mysite");

      const opensslCall = runner.recordedCalls.find((c) => c.command[0] === "openssl");
      expect(opensslCall).toBeDefined();
      expect(opensslCall?.command).toContain("req");
      expect(opensslCall?.command).toContain("-newkey");
      expect(opensslCall?.command).toContain("rsa:2048");
      expect(opensslCall?.command).toContain("-nodes");
      expect(opensslCall?.command).toContain("-x509");
      expect(opensslCall?.command).toContain("-days");
      expect(opensslCall?.command).toContain("365");
      expect(opensslCall?.command).toContain("-subj");
      expect(opensslCall?.command).toContain("/CN=localhost");
      expect(opensslCall?.command).toContain("/home/user/wod/mysite/wp-php-custom/cert.key");
      expect(opensslCall?.command).toContain("/home/user/wod/mysite/wp-php-custom/cert.pem");
    });

    test("uses custom versions in template files", async () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      const runner = setupSuccessRunner();
      const customConfig: CreateConfig = {
        wordpressVersion: "5.9",
        phpVersion: "7.4",
        mysqlVersion: "8.0",
        templateName: "php8.2",
        siteUrl: "http://127.0.0.1:9000",
      };
      const deps = createDeps({
        processRunner: runner,
        filesystem: fs,
        createConfig: customConfig,
      });
      await createInstance(deps, "mysite");

      const compose = fs.writtenFiles.get("/home/user/wod/mysite/docker-compose.yml");
      expect(compose).toContain("image: mysql:8.0");
      expect(compose).toContain("image: wordpress:5.9-php7.4-custom");

      const dockerfile = fs.writtenFiles.get("/home/user/wod/mysite/wp-php-custom/Dockerfile");
      expect(dockerfile).toContain("FROM wordpress:5.9-php7.4-apache");
    });
  });

  describe("docker compose", () => {
    test("runs docker compose up -d in instance directory", async () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      const runner = setupSuccessRunner();
      const deps = createDeps({ processRunner: runner, filesystem: fs });
      await createInstance(deps, "mysite");

      const composeCall = runner.recordedCalls.find(
        (c) => c.command[0] === "docker" && c.command[1] === "compose",
      );
      expect(composeCall).toBeDefined();
      expect(composeCall?.command).toEqual(["docker", "compose", "up", "-d"]);
      expect(composeCall?.options?.cwd).toBe("/home/user/wod/mysite");
    });

    test("returns compose exit code on failure", async () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      const runner = new MockProcessRunner();
      runner.addResponse(["docker", "container", "ls", "-aqf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "",
      });
      runner.addResponse(["docker", "container", "ls", "-aqf", "name=mysite-db-"], {
        exitCode: 0,
        stdout: "",
      });
      runner.addResponse(["docker", "volume", "ls", "-qf", "name=mysite_db_data"], {
        exitCode: 0,
        stdout: "",
      });
      runner.addResponse(["openssl"], { exitCode: 0 });
      runner.addResponse(["docker", "compose", "up", "-d"], {
        exitCode: 2,
        stderr: "compose error",
      });
      const deps = createDeps({ processRunner: runner, filesystem: fs });
      const result = await createInstance(deps, "mysite");
      expect(result.exitCode).toBe(2);
      expect(result.error).toContain("docker compose up failed");
    });

    test("does not proceed to wp install when compose fails", async () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      const runner = new MockProcessRunner();
      runner.addResponse(["docker", "container", "ls", "-aqf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "",
      });
      runner.addResponse(["docker", "container", "ls", "-aqf", "name=mysite-db-"], {
        exitCode: 0,
        stdout: "",
      });
      runner.addResponse(["docker", "volume", "ls", "-qf", "name=mysite_db_data"], {
        exitCode: 0,
        stdout: "",
      });
      runner.addResponse(["openssl"], { exitCode: 0 });
      runner.addResponse(["docker", "compose", "up", "-d"], { exitCode: 1 });
      const deps = createDeps({ processRunner: runner, filesystem: fs });
      await createInstance(deps, "mysite");
      // Should only have prerequisite checks + openssl + compose = 5 calls
      expect(runner.calls).toHaveLength(5);
    });
  });

  describe("sleep", () => {
    test("calls sleep with 10000ms after compose up", async () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      const runner = setupSuccessRunner();
      let sleepMs: number | null = null;
      const deps = createDeps({
        processRunner: runner,
        filesystem: fs,
        sleep: async (ms) => {
          sleepMs = ms;
        },
      });
      await createInstance(deps, "mysite");
      expect(sleepMs).toBe(10000);
    });
  });

  describe("wp core install", () => {
    test("returns error when container not found after compose up", async () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      const runner = new MockProcessRunner();
      runner.addResponse(["docker", "container", "ls", "-aqf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "",
      });
      runner.addResponse(["docker", "container", "ls", "-aqf", "name=mysite-db-"], {
        exitCode: 0,
        stdout: "",
      });
      runner.addResponse(["docker", "volume", "ls", "-qf", "name=mysite_db_data"], {
        exitCode: 0,
        stdout: "",
      });
      runner.addResponse(["openssl"], { exitCode: 0 });
      runner.addResponse(["docker", "compose", "up", "-d"], { exitCode: 0 });
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "",
      });
      const deps = createDeps({ processRunner: runner, filesystem: fs });
      const result = await createInstance(deps, "mysite");
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("WordPress container not found");
    });

    test("runs wp core install with correct arguments", async () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      const runner = setupSuccessRunner();
      const deps = createDeps({ processRunner: runner, filesystem: fs });
      await createInstance(deps, "mysite");

      const wpCall = runner.recordedCalls.find(
        (c) => c.command.includes("core") && c.command.includes("install"),
      );
      expect(wpCall).toBeDefined();
      expect(wpCall?.command).toContain("wordpress:cli");
      expect(wpCall?.command).toContain("--url=https://127.0.0.1:8443");
      expect(wpCall?.command).toContain("--title=Testing WordPress");
      expect(wpCall?.command).toContain("--admin_user=admin");
      expect(wpCall?.command).toContain("--admin_email=admin@127.0.0.1");
    });

    test("passes WORDPRESS env vars to wp-cli container", async () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      const runner = setupSuccessRunner();
      const deps = createDeps({ processRunner: runner, filesystem: fs });
      await createInstance(deps, "mysite");

      const wpCall = runner.recordedCalls.find(
        (c) => c.command.includes("core") && c.command.includes("install"),
      );
      expect(wpCall?.command).toContain("--env");
      expect(wpCall?.command).toContain("WORDPRESS_DB_HOST=db:3306");
      expect(wpCall?.command).toContain("WORDPRESS_DB_USER=wordpress");
      // HOME=/root should NOT be passed (not a WORDPRESS_ var)
      expect(wpCall?.command).not.toContain("HOME=/root");
    });

    test("uses --volumes-from and --network container flags", async () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      const runner = setupSuccessRunner();
      const deps = createDeps({ processRunner: runner, filesystem: fs });
      await createInstance(deps, "mysite");

      const wpCall = runner.recordedCalls.find(
        (c) => c.command.includes("core") && c.command.includes("install"),
      );
      expect(wpCall?.command).toContain("--volumes-from");
      expect(wpCall?.command).toContain("abc123");
      expect(wpCall?.command).toContain("--network");
      expect(wpCall?.command).toContain("container:abc123");
      expect(wpCall?.command).toContain("--user");
      expect(wpCall?.command).toContain("33:33");
    });

    test("returns wp-cli exit code on failure", async () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      const runner = new MockProcessRunner();
      runner.addResponse(["docker", "container", "ls", "-aqf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "",
      });
      runner.addResponse(["docker", "container", "ls", "-aqf", "name=mysite-db-"], {
        exitCode: 0,
        stdout: "",
      });
      runner.addResponse(["docker", "volume", "ls", "-qf", "name=mysite_db_data"], {
        exitCode: 0,
        stdout: "",
      });
      runner.addResponse(["openssl"], { exitCode: 0 });
      runner.addResponse(["docker", "compose", "up", "-d"], { exitCode: 0 });
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "/bin/env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      runner.addResponse(["docker", "run"], { exitCode: 1, stderr: "install failed" });
      const deps = createDeps({ processRunner: runner, filesystem: fs });
      const result = await createInstance(deps, "mysite");
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("wp core install failed");
    });
  });

  describe("full success path", () => {
    test("returns exit code 0 with site URL on success", async () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      const runner = setupSuccessRunner();
      const deps = createDeps({ processRunner: runner, filesystem: fs });
      const result = await createInstance(deps, "mysite");
      expect(result.exitCode).toBe(0);
      expect(result.siteUrl).toBe("https://127.0.0.1:8443");
      expect(result.error).toBeNull();
    });

    test("returns admin password from wp core install output", async () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      const runner = setupSuccessRunner();
      const deps = createDeps({ processRunner: runner, filesystem: fs });
      const result = await createInstance(deps, "mysite");
      expect(result.adminPassword).toBe("xK7$m2pQ");
    });

    test("returns custom site URL when configured", async () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      const runner = setupSuccessRunner();
      const customConfig = { ...defaultCreateConfig, siteUrl: "http://127.0.0.1:9000" };
      const deps = createDeps({
        processRunner: runner,
        filesystem: fs,
        createConfig: customConfig,
      });
      const result = await createInstance(deps, "mysite");
      expect(result.exitCode).toBe(0);
      expect(result.siteUrl).toBe("http://127.0.0.1:9000");
    });
  });

  describe("backup restore integration", () => {
    test("validates backupDir exists before proceeding", async () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      // backupDir does not exist — not added to existingDirs
      const runner = new MockProcessRunner();
      runner.addResponse(["docker", "container", "ls", "-aqf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "",
      });
      runner.addResponse(["docker", "container", "ls", "-aqf", "name=mysite-db-"], {
        exitCode: 0,
        stdout: "",
      });
      runner.addResponse(["docker", "volume", "ls", "-qf", "name=mysite_db_data"], {
        exitCode: 0,
        stdout: "",
      });
      const deps = createDeps({ processRunner: runner, filesystem: fs });
      const result = await createInstance(deps, "mysite", "/nonexistent/backups");
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("Backup directory does not exist");
    });

    test("creates instance and restores when backupDir provided", async () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      fs.addDirectory("/backups");
      // Don't add /home/user/wod/mysite — ensureDirectory will register it
      fs.setDirFiles("/backups", ["backup_2024-01-01-db.gz"]);

      const runner = setupSuccessRunner();
      // Restore: chown
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });
      // Restore: zcat | head (header parsing) — no table prefix
      runner.addResponse(["bash", "-c"], { exitCode: 0, stdout: "# no header\n" });
      // Restore: docker container ls (reuses existing prefix match)
      // Restore: docker exec env (reuses existing prefix match)
      // Restore: bash -c db import (reuses bash -c prefix match)

      const deps = createDeps({ processRunner: runner, filesystem: fs });
      const result = await createInstance(deps, "mysite", "/backups");
      expect(result.exitCode).toBe(0);
      expect(result.error).toBeNull();

      // Verify restore-related calls occurred
      const chownCall = runner.recordedCalls.find(
        (c) => c.command[0] === "sudo" && c.command[1] === "chown",
      );
      expect(chownCall).toBeDefined();

      // Verify wp option set siteurl and home calls
      const optionSetCalls = runner.recordedCalls.filter(
        (c) => c.command.includes("option") && c.command.includes("set"),
      );
      expect(optionSetCalls).toHaveLength(2);
      expect(optionSetCalls[0].command).toContain("siteurl");
      expect(optionSetCalls[0].command).toContain("https://127.0.0.1:8443");
      expect(optionSetCalls[1].command).toContain("home");
      expect(optionSetCalls[1].command).toContain("https://127.0.0.1:8443");
    });

    test("returns error if restore fails", async () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      fs.addDirectory("/backups");
      fs.setDirFiles("/backups", ["backup_2024-01-01-plugins.zip"]);

      const runner = setupSuccessRunner();
      // Restore: unzip fails
      runner.addResponse(["sudo", "unzip"], { exitCode: 1, stderr: "unzip error" });

      const deps = createDeps({ processRunner: runner, filesystem: fs });
      const result = await createInstance(deps, "mysite", "/backups");
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("Failed to extract");
    });

    test("does not restore when backupDir is not provided", async () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/other");
      const runner = setupSuccessRunner();
      const deps = createDeps({ processRunner: runner, filesystem: fs });
      const result = await createInstance(deps, "mysite");
      expect(result.exitCode).toBe(0);

      // No restore-related calls
      const chownCall = runner.recordedCalls.find(
        (c) => c.command[0] === "sudo" && c.command[1] === "chown",
      );
      expect(chownCall).toBeUndefined();
    });
  });
});
