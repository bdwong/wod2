import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gzipSync } from "node:zlib";
import { MockProcessRunner } from "../docker/mock-process-runner.ts";
import { MockFilesystem } from "../utils/mock-filesystem.ts";
import { type RestoreDependencies, restoreInstance, transformSql } from "./restore.ts";

function createDeps(overrides?: Partial<RestoreDependencies>): RestoreDependencies {
  return {
    processRunner: overrides?.processRunner ?? new MockProcessRunner(),
    filesystem: overrides?.filesystem ?? new MockFilesystem(),
    config: overrides?.config ?? { wodHome: "/home/user/wod" },
  };
}

/** Create a real gzipped file on disk for DB tests */
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "restore-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createGzFile(filename: string, content: string): string {
  const filePath = path.join(tmpDir, filename);
  fs.writeFileSync(filePath, gzipSync(Buffer.from(content, "utf-8")));
  return filePath;
}

const DEFAULT_DB_CONTENT = "# no header\nCREATE TABLE foo;";

function setupFilesystemWithBackups(mockFs: MockFilesystem): void {
  mockFs.addDirectory("/home/user/wod/mysite");
  mockFs.addDirectory(tmpDir);
  mockFs.setDirFiles(tmpDir, [
    "backup_2024-01-01-plugins.zip",
    "backup_2024-01-01-themes.zip",
    "backup_2024-01-01-uploads.zip",
    "backup_2024-01-01-uploads2.zip",
    "backup_2024-01-01-others.zip",
    "backup_2024-01-01-db.gz",
  ]);
  createGzFile("backup_2024-01-01-db.gz", DEFAULT_DB_CONTENT);
}

function setupSuccessRunner(): MockProcessRunner {
  const runner = new MockProcessRunner();
  // rm -rf for each content type (plugins, themes, uploads, others)
  runner.addResponse(["sudo", "rm", "-rf"], { exitCode: 0 });
  runner.addResponse(["sudo", "rm", "-rf"], { exitCode: 0 });
  runner.addResponse(["sudo", "rm", "-rf"], { exitCode: 0 });
  runner.addResponse(["sudo", "rm", "-rf"], { exitCode: 0 });
  // unzip for each zip (5 files: plugins, themes, uploads, uploads2, others)
  runner.addResponse(["sudo", "unzip"], { exitCode: 0 });
  runner.addResponse(["sudo", "unzip"], { exitCode: 0 });
  runner.addResponse(["sudo", "unzip"], { exitCode: 0 });
  runner.addResponse(["sudo", "unzip"], { exitCode: 0 });
  runner.addResponse(["sudo", "unzip"], { exitCode: 0 });
  // chown
  runner.addResponse(["sudo", "chown"], { exitCode: 0 });
  // docker container ls (find WordPress container)
  runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
    exitCode: 0,
    stdout: "abc123\n",
  });
  // docker exec (env vars)
  runner.addResponse(["docker", "exec", "abc123", "env"], {
    exitCode: 0,
    stdout: "WORDPRESS_DB_HOST=db:3306\nWORDPRESS_DB_USER=wordpress\nHOME=/root\n",
  });
  // docker run (async db import)
  runner.addAsyncResponse(["docker", "run"], { exitCode: 0 });
  return runner;
}

describe("transformSql", () => {
  test("removes MariaDB directive lines", () => {
    const input = "CREATE TABLE foo;\n/*M! some mariadb thing */;\nINSERT INTO foo;";
    const result = transformSql(input);
    expect(result).not.toContain("/*M!");
    expect(result).toContain("CREATE TABLE foo;");
    expect(result).toContain("INSERT INTO foo;");
  });

  test("inserts SQL mode directive after # ----- lines", () => {
    const input = "# header\n# -----\nCREATE TABLE foo;";
    const result = transformSql(input);
    expect(result).toContain("# -----\n/*!40101 SET sql_mode=");
    expect(result).toContain("NO_AUTO_CREATE_USER");
  });

  test("handles both transformations together", () => {
    const input =
      "# header\n# -----\n/*M! MariaDB directive */;\nCREATE TABLE foo;\n/*M! another */;";
    const result = transformSql(input);
    const lines = result.split("\n");
    expect(lines[0]).toBe("# header");
    expect(lines[1]).toBe("# -----");
    expect(lines[2]).toContain("SET sql_mode=");
    expect(lines[3]).toBe("CREATE TABLE foo;");
    expect(lines).toHaveLength(4);
  });

  test("passes through SQL without markers unchanged", () => {
    const input = "CREATE TABLE foo;\nINSERT INTO foo VALUES (1);";
    expect(transformSql(input)).toBe(input);
  });
});

describe("restoreInstance", () => {
  describe("validation", () => {
    test("returns error when instance directory does not exist", async () => {
      const mockFs = new MockFilesystem();
      mockFs.addDirectory("/backups");
      const deps = createDeps({ filesystem: mockFs });
      const result = await restoreInstance(deps, "mysite", "/backups");
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("Instance directory does not exist");
    });

    test("returns error when backup directory does not exist", async () => {
      const mockFs = new MockFilesystem();
      mockFs.addDirectory("/home/user/wod/mysite");
      const deps = createDeps({ filesystem: mockFs });
      const result = await restoreInstance(deps, "mysite", "/backups");
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("Backup directory does not exist");
    });
  });

  describe("content restore", () => {
    test("extracts each content type from backup zips", async () => {
      const mockFs = new MockFilesystem();
      setupFilesystemWithBackups(mockFs);
      mockFs.addDirectory("/home/user/wod/mysite/site/wp-content/plugins");
      mockFs.addDirectory("/home/user/wod/mysite/site/wp-content/themes");
      mockFs.addDirectory("/home/user/wod/mysite/site/wp-content/uploads");
      mockFs.addDirectory("/home/user/wod/mysite/site/wp-content/others");
      const runner = setupSuccessRunner();
      const deps = createDeps({ processRunner: runner, filesystem: mockFs });
      const result = await restoreInstance(deps, "mysite", tmpDir);

      expect(result.exitCode).toBe(0);

      const unzipCalls = runner.recordedCalls.filter((c) => c.command[1] === "unzip");
      expect(unzipCalls).toHaveLength(5);

      for (const call of unzipCalls) {
        expect(call.command).toContain("/home/user/wod/mysite/site/wp-content");
      }
    });

    test("handles missing content types with warnings", async () => {
      createGzFile("backup_2024-01-01-db.gz", DEFAULT_DB_CONTENT);

      const mockFs = new MockFilesystem();
      mockFs.addDirectory("/home/user/wod/mysite");
      mockFs.addDirectory(tmpDir);
      mockFs.setDirFiles(tmpDir, ["backup_2024-01-01-plugins.zip", "backup_2024-01-01-db.gz"]);
      mockFs.addDirectory("/home/user/wod/mysite/site/wp-content/plugins");

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "rm", "-rf"], { exitCode: 0 });
      runner.addResponse(["sudo", "unzip"], { exitCode: 0 });
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      runner.addAsyncResponse(["docker", "run"], { exitCode: 0 });

      const deps = createDeps({ processRunner: runner, filesystem: mockFs });
      const result = await restoreInstance(deps, "mysite", tmpDir);

      expect(result.exitCode).toBe(0);
      expect(result.warnings).toContain("No themes backup found (backup*-themes*.zip)");
      expect(result.warnings).toContain("No uploads backup found (backup*-uploads*.zip)");
      expect(result.warnings).toContain("No others backup found (backup*-others*.zip)");
    });

    test("handles multi-part archives (uploads split across files)", async () => {
      const mockFs = new MockFilesystem();
      mockFs.addDirectory("/home/user/wod/mysite");
      mockFs.addDirectory("/backups");
      mockFs.setDirFiles("/backups", [
        "backup_2024-01-01-uploads.zip",
        "backup_2024-01-01-uploads2.zip",
      ]);

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "unzip"], { exitCode: 0 });
      runner.addResponse(["sudo", "unzip"], { exitCode: 0 });
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });
      // No DB
      const deps = createDeps({ processRunner: runner, filesystem: mockFs });
      const result = await restoreInstance(deps, "mysite", "/backups");

      expect(result.exitCode).toBe(0);
      const unzipCalls = runner.recordedCalls.filter((c) => c.command[1] === "unzip");
      expect(unzipCalls).toHaveLength(2);
    });

    test("removes existing wp-content subdirs before extraction", async () => {
      const mockFs = new MockFilesystem();
      mockFs.addDirectory("/home/user/wod/mysite");
      mockFs.addDirectory("/backups");
      mockFs.addDirectory("/home/user/wod/mysite/site/wp-content/plugins");
      mockFs.setDirFiles("/backups", ["backup_2024-01-01-plugins.zip"]);

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "rm", "-rf"], { exitCode: 0 });
      runner.addResponse(["sudo", "unzip"], { exitCode: 0 });
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });

      const deps = createDeps({ processRunner: runner, filesystem: mockFs });
      await restoreInstance(deps, "mysite", "/backups");

      const rmCall = runner.recordedCalls.find(
        (c) => c.command[1] === "rm" && c.command[2] === "-rf",
      );
      expect(rmCall).toBeDefined();
      expect(rmCall?.command[3]).toBe("/home/user/wod/mysite/site/wp-content/plugins");
    });
  });

  describe("permissions", () => {
    test("runs chown after content extraction", async () => {
      const mockFs = new MockFilesystem();
      mockFs.addDirectory("/home/user/wod/mysite");
      mockFs.addDirectory("/backups");
      mockFs.setDirFiles("/backups", ["backup_2024-01-01-plugins.zip"]);

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "unzip"], { exitCode: 0 });
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });

      const deps = createDeps({ processRunner: runner, filesystem: mockFs });
      await restoreInstance(deps, "mysite", "/backups");

      const chownCall = runner.recordedCalls.find(
        (c) => c.command[0] === "sudo" && c.command[1] === "chown",
      );
      expect(chownCall).toBeDefined();
      expect(chownCall?.command).toEqual([
        "sudo",
        "chown",
        "-R",
        "www-data:www-data",
        "/home/user/wod/mysite/site/wp-content",
      ]);
    });
  });

  describe("database restore", () => {
    test("finds backup*-db.gz for database restore", async () => {
      createGzFile("backup_2024-01-01-db.gz", DEFAULT_DB_CONTENT);

      const mockFs = new MockFilesystem();
      mockFs.addDirectory("/home/user/wod/mysite");
      mockFs.addDirectory(tmpDir);
      mockFs.setDirFiles(tmpDir, ["backup_2024-01-01-db.gz"]);

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      runner.addAsyncResponse(["docker", "run"], { exitCode: 0 });

      const deps = createDeps({ processRunner: runner, filesystem: mockFs });
      const result = await restoreInstance(deps, "mysite", tmpDir);

      expect(result.exitCode).toBe(0);
      const dockerRunCall = runner.recordedCalls.find(
        (c) => c.command[0] === "docker" && c.command[1] === "run",
      );
      expect(dockerRunCall).toBeDefined();
      expect(dockerRunCall?.command).toContain("wp");
      expect(dockerRunCall?.command).toContain("db");
      expect(dockerRunCall?.command).toContain("import");
    });

    test("falls back to *.sql.gz when no backup*-db.gz found", async () => {
      createGzFile("dump.sql.gz", DEFAULT_DB_CONTENT);

      const mockFs = new MockFilesystem();
      mockFs.addDirectory("/home/user/wod/mysite");
      mockFs.addDirectory(tmpDir);
      mockFs.setDirFiles(tmpDir, ["dump.sql.gz"]);

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      runner.addAsyncResponse(["docker", "run"], { exitCode: 0 });

      const deps = createDeps({ processRunner: runner, filesystem: mockFs });
      const result = await restoreInstance(deps, "mysite", tmpDir);

      expect(result.exitCode).toBe(0);
      const dockerRunCall = runner.recordedCalls.find(
        (c) => c.command[0] === "docker" && c.command[1] === "run",
      );
      expect(dockerRunCall).toBeDefined();
    });

    test("warns if no database dump found", async () => {
      const mockFs = new MockFilesystem();
      mockFs.addDirectory("/home/user/wod/mysite");
      mockFs.addDirectory("/backups");
      mockFs.setDirFiles("/backups", []);

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });

      const deps = createDeps({ processRunner: runner, filesystem: mockFs });
      const result = await restoreInstance(deps, "mysite", "/backups");

      expect(result.exitCode).toBe(0);
      expect(result.warnings).toContain("No database backup found");
    });
  });

  describe("table prefix", () => {
    test("parses UpdraftPlus header and updates wp-config.php", async () => {
      const dbContent =
        "# WordPress MySQL database backup\n# Table prefix: wp_custom_\n# -----\nCREATE TABLE foo;";
      createGzFile("backup_2024-01-01-db.gz", dbContent);

      const mockFs = new MockFilesystem();
      mockFs.addDirectory("/home/user/wod/mysite");
      mockFs.addDirectory(tmpDir);
      mockFs.setDirFiles(tmpDir, ["backup_2024-01-01-db.gz"]);

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });
      runner.addResponse(["sudo", "cat"], {
        exitCode: 0,
        stdout: "<?php\n$table_prefix = 'wp_';\n",
      });
      runner.addResponse(["sudo", "tee"], { exitCode: 0 });
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      runner.addAsyncResponse(["docker", "run"], { exitCode: 0 });

      const deps = createDeps({ processRunner: runner, filesystem: mockFs });
      const result = await restoreInstance(deps, "mysite", tmpDir);

      expect(result.exitCode).toBe(0);

      const catCall = runner.recordedCalls.find(
        (c) => c.command[0] === "sudo" && c.command[1] === "cat",
      );
      expect(catCall).toBeDefined();
      expect(catCall?.command[2]).toBe("/home/user/wod/mysite/site/wp-config.php");

      const teeCall = runner.recordedCalls.find(
        (c) => c.command[0] === "sudo" && c.command[1] === "tee",
      );
      expect(teeCall).toBeDefined();
      expect(teeCall?.command[2]).toBe("/home/user/wod/mysite/site/wp-config.php");
      expect(teeCall?.stdinContent).toContain("wp_custom_");
    });

    test("updates getenv_docker table_prefix format in wp-config.php", async () => {
      const dbContent =
        "# WordPress MySQL database backup\n# Table prefix: wp_custom_\n# -----\nCREATE TABLE foo;";
      createGzFile("backup_2024-01-01-db.gz", dbContent);

      const mockFs = new MockFilesystem();
      mockFs.addDirectory("/home/user/wod/mysite");
      mockFs.addDirectory(tmpDir);
      mockFs.setDirFiles(tmpDir, ["backup_2024-01-01-db.gz"]);

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });
      runner.addResponse(["sudo", "cat"], {
        exitCode: 0,
        stdout: "<?php\n$table_prefix = getenv_docker('WORDPRESS_TABLE_PREFIX', 'wp_');\n",
      });
      runner.addResponse(["sudo", "tee"], { exitCode: 0 });
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      runner.addAsyncResponse(["docker", "run"], { exitCode: 0 });

      const deps = createDeps({ processRunner: runner, filesystem: mockFs });
      const result = await restoreInstance(deps, "mysite", tmpDir);

      expect(result.exitCode).toBe(0);

      const teeCall = runner.recordedCalls.find(
        (c) => c.command[0] === "sudo" && c.command[1] === "tee",
      );
      expect(teeCall).toBeDefined();
      expect(teeCall?.stdinContent).toContain("$table_prefix = 'wp_custom_';");
      expect(teeCall?.stdinContent).not.toContain("getenv_docker");
    });

    test("warns when table_prefix line not found in wp-config.php", async () => {
      const dbContent =
        "# WordPress MySQL database backup\n# Table prefix: wp_custom_\n# -----\nCREATE TABLE foo;";
      createGzFile("backup_2024-01-01-db.gz", dbContent);

      const mockFs = new MockFilesystem();
      mockFs.addDirectory("/home/user/wod/mysite");
      mockFs.addDirectory(tmpDir);
      mockFs.setDirFiles(tmpDir, ["backup_2024-01-01-db.gz"]);

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });
      runner.addResponse(["sudo", "cat"], {
        exitCode: 0,
        stdout: "<?php\n// no table prefix here\n",
      });
      runner.addResponse(["sudo", "tee"], { exitCode: 0 });
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      runner.addAsyncResponse(["docker", "run"], { exitCode: 0 });

      const deps = createDeps({ processRunner: runner, filesystem: mockFs });
      const result = await restoreInstance(deps, "mysite", tmpDir);

      expect(result.exitCode).toBe(0);
      expect(result.warnings).toContain(
        "Could not find table_prefix line in wp-config.php to update",
      );
    });

    test("skips table prefix update when no prefix found in header", async () => {
      const dbContent = "# Just a regular SQL dump\nCREATE TABLE foo;";
      createGzFile("backup_2024-01-01-db.gz", dbContent);

      const mockFs = new MockFilesystem();
      mockFs.addDirectory("/home/user/wod/mysite");
      mockFs.addDirectory(tmpDir);
      mockFs.setDirFiles(tmpDir, ["backup_2024-01-01-db.gz"]);

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      runner.addAsyncResponse(["docker", "run"], { exitCode: 0 });

      const deps = createDeps({ processRunner: runner, filesystem: mockFs });
      const result = await restoreInstance(deps, "mysite", tmpDir);

      expect(result.exitCode).toBe(0);
      const catCall = runner.recordedCalls.find(
        (c) => c.command[0] === "sudo" && c.command[1] === "cat",
      );
      expect(catCall).toBeUndefined();
    });
  });

  describe("database import", () => {
    test("streams transformed SQL to docker run via runAsync", async () => {
      const dbContent =
        "# header\n# -----\n/*M! MariaDB directive */;\nCREATE TABLE foo;\nINSERT INTO foo;";
      createGzFile("backup_2024-01-01-db.gz", dbContent);

      const mockFs = new MockFilesystem();
      mockFs.addDirectory("/home/user/wod/mysite");
      mockFs.addDirectory(tmpDir);
      mockFs.setDirFiles(tmpDir, ["backup_2024-01-01-db.gz"]);

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      runner.addAsyncResponse(["docker", "run"], { exitCode: 0 });

      const deps = createDeps({ processRunner: runner, filesystem: mockFs });
      await restoreInstance(deps, "mysite", tmpDir);

      const dockerRunCall = runner.recordedCalls.find(
        (c) => c.command[0] === "docker" && c.command[1] === "run",
      );
      expect(dockerRunCall).toBeDefined();
      expect(dockerRunCall?.command).toContain("wp");
      expect(dockerRunCall?.command).toContain("db");
      expect(dockerRunCall?.command).toContain("import");
      expect(dockerRunCall?.command).toContain("-i");

      // Verify stdin contained transformed SQL
      const stdin = dockerRunCall?.stdinContent ?? "";
      expect(stdin).toContain("# header");
      expect(stdin).toContain("SET sql_mode=");
      expect(stdin).not.toContain("/*M!");
      expect(stdin).toContain("CREATE TABLE foo;");
      expect(stdin).toContain("INSERT INTO foo;");
    });
  });

  describe("URL rewriting", () => {
    test("rewrites siteurl and home when siteUrl option is provided", async () => {
      createGzFile("backup_2024-01-01-db.gz", DEFAULT_DB_CONTENT);

      const mockFs = new MockFilesystem();
      mockFs.addDirectory("/home/user/wod/mysite");
      mockFs.addDirectory(tmpDir);
      mockFs.setDirFiles(tmpDir, ["backup_2024-01-01-db.gz"]);

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      runner.addAsyncResponse(["docker", "run"], { exitCode: 0 });
      // wp option set siteurl + home
      runner.addResponse(["docker", "run"], { exitCode: 0 });
      runner.addResponse(["docker", "run"], { exitCode: 0 });

      const deps = createDeps({ processRunner: runner, filesystem: mockFs });
      const result = await restoreInstance(deps, "mysite", tmpDir, {
        siteUrl: "https://127.0.0.1:8443",
      });

      expect(result.exitCode).toBe(0);
      const optionSetCalls = runner.recordedCalls.filter(
        (c) => c.command.includes("option") && c.command.includes("set"),
      );
      expect(optionSetCalls).toHaveLength(2);
      expect(optionSetCalls[0].command).toContain("siteurl");
      expect(optionSetCalls[0].command).toContain("https://127.0.0.1:8443");
      expect(optionSetCalls[1].command).toContain("home");
      expect(optionSetCalls[1].command).toContain("https://127.0.0.1:8443");
    });

    test("skips URL rewrite when keepUrls option is set", async () => {
      createGzFile("backup_2024-01-01-db.gz", DEFAULT_DB_CONTENT);

      const mockFs = new MockFilesystem();
      mockFs.addDirectory("/home/user/wod/mysite");
      mockFs.addDirectory(tmpDir);
      mockFs.setDirFiles(tmpDir, ["backup_2024-01-01-db.gz"]);

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      runner.addAsyncResponse(["docker", "run"], { exitCode: 0 });

      const deps = createDeps({ processRunner: runner, filesystem: mockFs });
      const result = await restoreInstance(deps, "mysite", tmpDir, {
        keepUrls: true,
        siteUrl: "https://127.0.0.1:8443",
      });

      expect(result.exitCode).toBe(0);
      const optionSetCalls = runner.recordedCalls.filter(
        (c) => c.command.includes("option") && c.command.includes("set"),
      );
      expect(optionSetCalls).toHaveLength(0);
    });

    test("skips URL rewrite when no siteUrl provided", async () => {
      createGzFile("backup_2024-01-01-db.gz", DEFAULT_DB_CONTENT);

      const mockFs = new MockFilesystem();
      mockFs.addDirectory("/home/user/wod/mysite");
      mockFs.addDirectory(tmpDir);
      mockFs.setDirFiles(tmpDir, ["backup_2024-01-01-db.gz"]);

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      runner.addAsyncResponse(["docker", "run"], { exitCode: 0 });

      const deps = createDeps({ processRunner: runner, filesystem: mockFs });
      const result = await restoreInstance(deps, "mysite", tmpDir);

      expect(result.exitCode).toBe(0);
      const optionSetCalls = runner.recordedCalls.filter(
        (c) => c.command.includes("option") && c.command.includes("set"),
      );
      expect(optionSetCalls).toHaveLength(0);
    });

    test("uses custom site URL from --site-url option", async () => {
      createGzFile("backup_2024-01-01-db.gz", DEFAULT_DB_CONTENT);

      const mockFs = new MockFilesystem();
      mockFs.addDirectory("/home/user/wod/mysite");
      mockFs.addDirectory(tmpDir);
      mockFs.setDirFiles(tmpDir, ["backup_2024-01-01-db.gz"]);

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      runner.addAsyncResponse(["docker", "run"], { exitCode: 0 });
      runner.addResponse(["docker", "run"], { exitCode: 0 });
      runner.addResponse(["docker", "run"], { exitCode: 0 });

      const deps = createDeps({ processRunner: runner, filesystem: mockFs });
      const result = await restoreInstance(deps, "mysite", tmpDir, {
        siteUrl: "https://example.com",
      });

      expect(result.exitCode).toBe(0);
      const optionSetCalls = runner.recordedCalls.filter(
        (c) => c.command.includes("option") && c.command.includes("set"),
      );
      expect(optionSetCalls).toHaveLength(2);
      expect(optionSetCalls[0].command).toContain("https://example.com");
      expect(optionSetCalls[1].command).toContain("https://example.com");
    });
  });

  describe("full success path", () => {
    test("all content types + DB restored returns exitCode 0", async () => {
      const mockFs = new MockFilesystem();
      setupFilesystemWithBackups(mockFs);
      mockFs.addDirectory("/home/user/wod/mysite/site/wp-content/plugins");
      mockFs.addDirectory("/home/user/wod/mysite/site/wp-content/themes");
      mockFs.addDirectory("/home/user/wod/mysite/site/wp-content/uploads");
      mockFs.addDirectory("/home/user/wod/mysite/site/wp-content/others");
      const runner = setupSuccessRunner();
      const deps = createDeps({ processRunner: runner, filesystem: mockFs });
      const result = await restoreInstance(deps, "mysite", tmpDir);

      expect(result.exitCode).toBe(0);
      expect(result.error).toBeNull();
      expect(result.warnings).toHaveLength(0);
    });
  });
});
