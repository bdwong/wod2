import { describe, expect, test } from "bun:test";
import { MockProcessRunner } from "../docker/mock-process-runner.ts";
import { MockFilesystem } from "../utils/mock-filesystem.ts";
import { type RestoreDependencies, restoreInstance } from "./restore.ts";

function createDeps(overrides?: Partial<RestoreDependencies>): RestoreDependencies {
  return {
    processRunner: overrides?.processRunner ?? new MockProcessRunner(),
    filesystem: overrides?.filesystem ?? new MockFilesystem(),
    config: overrides?.config ?? { wodHome: "/home/user/wod" },
  };
}

function setupFilesystemWithBackups(fs: MockFilesystem): void {
  fs.addDirectory("/home/user/wod/mysite");
  fs.addDirectory("/backups");
  fs.setDirFiles("/backups", [
    "backup_2024-01-01-plugins.zip",
    "backup_2024-01-01-themes.zip",
    "backup_2024-01-01-uploads.zip",
    "backup_2024-01-01-uploads2.zip",
    "backup_2024-01-01-others.zip",
    "backup_2024-01-01-db.gz",
  ]);
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
  // zcat | head (header parsing)
  runner.addResponse(["bash", "-c"], {
    exitCode: 0,
    stdout:
      "# WordPress MySQL database backup\n# Created by UpdraftPlus version 1.22.3\n# Table prefix: wp_custom_\n# -----\n",
  });
  // sudo sed (table prefix update)
  runner.addResponse(["sudo", "sed"], { exitCode: 0 });
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
  // bash -c (db import pipeline)
  runner.addResponse(["bash", "-c"], { exitCode: 0 });
  return runner;
}

describe("restoreInstance", () => {
  describe("validation", () => {
    test("returns error when instance directory does not exist", () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/backups");
      // Don't add /home/user/wod/mysite
      const deps = createDeps({ filesystem: fs });
      const result = restoreInstance(deps, "mysite", "/backups");
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("Instance directory does not exist");
    });

    test("returns error when backup directory does not exist", () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/mysite");
      // Don't add /backups
      const deps = createDeps({ filesystem: fs });
      const result = restoreInstance(deps, "mysite", "/backups");
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("Backup directory does not exist");
    });
  });

  describe("content restore", () => {
    test("extracts each content type from backup zips", () => {
      const fs = new MockFilesystem();
      setupFilesystemWithBackups(fs);
      // Mark wp-content subdirs as existing
      fs.addDirectory("/home/user/wod/mysite/site/wp-content/plugins");
      fs.addDirectory("/home/user/wod/mysite/site/wp-content/themes");
      fs.addDirectory("/home/user/wod/mysite/site/wp-content/uploads");
      fs.addDirectory("/home/user/wod/mysite/site/wp-content/others");
      const runner = setupSuccessRunner();
      const deps = createDeps({ processRunner: runner, filesystem: fs });
      const result = restoreInstance(deps, "mysite", "/backups");

      expect(result.exitCode).toBe(0);

      // Check unzip calls
      const unzipCalls = runner.recordedCalls.filter((c) => c.command[1] === "unzip");
      expect(unzipCalls).toHaveLength(5); // plugins, themes, uploads, uploads2, others

      // Verify extraction target
      for (const call of unzipCalls) {
        expect(call.command).toContain("/home/user/wod/mysite/site/wp-content");
      }
    });

    test("handles missing content types with warnings", () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/mysite");
      fs.addDirectory("/backups");
      // Only provide plugins backup
      fs.setDirFiles("/backups", ["backup_2024-01-01-plugins.zip", "backup_2024-01-01-db.gz"]);
      fs.addDirectory("/home/user/wod/mysite/site/wp-content/plugins");

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "rm", "-rf"], { exitCode: 0 });
      runner.addResponse(["sudo", "unzip"], { exitCode: 0 });
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });
      runner.addResponse(["bash", "-c"], { exitCode: 0, stdout: "# No header\n" });
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      runner.addResponse(["bash", "-c"], { exitCode: 0 });

      const deps = createDeps({ processRunner: runner, filesystem: fs });
      const result = restoreInstance(deps, "mysite", "/backups");

      expect(result.exitCode).toBe(0);
      expect(result.warnings).toContain("No themes backup found (backup*-themes*.zip)");
      expect(result.warnings).toContain("No uploads backup found (backup*-uploads*.zip)");
      expect(result.warnings).toContain("No others backup found (backup*-others*.zip)");
    });

    test("handles multi-part archives (uploads split across files)", () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/mysite");
      fs.addDirectory("/backups");
      fs.setDirFiles("/backups", [
        "backup_2024-01-01-uploads.zip",
        "backup_2024-01-01-uploads2.zip",
      ]);

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "unzip"], { exitCode: 0 });
      runner.addResponse(["sudo", "unzip"], { exitCode: 0 });
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });
      // No DB
      const deps = createDeps({ processRunner: runner, filesystem: fs });
      const result = restoreInstance(deps, "mysite", "/backups");

      expect(result.exitCode).toBe(0);
      const unzipCalls = runner.recordedCalls.filter((c) => c.command[1] === "unzip");
      expect(unzipCalls).toHaveLength(2);
    });

    test("removes existing wp-content subdirs before extraction", () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/mysite");
      fs.addDirectory("/backups");
      fs.addDirectory("/home/user/wod/mysite/site/wp-content/plugins");
      fs.setDirFiles("/backups", ["backup_2024-01-01-plugins.zip"]);

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "rm", "-rf"], { exitCode: 0 });
      runner.addResponse(["sudo", "unzip"], { exitCode: 0 });
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });

      const deps = createDeps({ processRunner: runner, filesystem: fs });
      restoreInstance(deps, "mysite", "/backups");

      const rmCall = runner.recordedCalls.find(
        (c) => c.command[1] === "rm" && c.command[2] === "-rf",
      );
      expect(rmCall).toBeDefined();
      expect(rmCall?.command[3]).toBe("/home/user/wod/mysite/site/wp-content/plugins");
    });
  });

  describe("permissions", () => {
    test("runs chown after content extraction", () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/mysite");
      fs.addDirectory("/backups");
      fs.setDirFiles("/backups", ["backup_2024-01-01-plugins.zip"]);

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "unzip"], { exitCode: 0 });
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });

      const deps = createDeps({ processRunner: runner, filesystem: fs });
      restoreInstance(deps, "mysite", "/backups");

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
    test("finds backup*-db.gz for database restore", () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/mysite");
      fs.addDirectory("/backups");
      fs.setDirFiles("/backups", ["backup_2024-01-01-db.gz"]);

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });
      runner.addResponse(["bash", "-c"], { exitCode: 0, stdout: "# no header\n" });
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      runner.addResponse(["bash", "-c"], { exitCode: 0 });

      const deps = createDeps({ processRunner: runner, filesystem: fs });
      const result = restoreInstance(deps, "mysite", "/backups");

      expect(result.exitCode).toBe(0);
      // The header parse call should reference the db.gz file
      const headerCall = runner.recordedCalls.find(
        (c) => c.command[0] === "bash" && c.command[2]?.includes("zcat"),
      );
      expect(headerCall?.command[2]).toContain("backup_2024-01-01-db.gz");
    });

    test("falls back to *.sql.gz when no backup*-db.gz found", () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/mysite");
      fs.addDirectory("/backups");
      fs.setDirFiles("/backups", ["dump.sql.gz"]);

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });
      runner.addResponse(["bash", "-c"], { exitCode: 0, stdout: "# no header\n" });
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      runner.addResponse(["bash", "-c"], { exitCode: 0 });

      const deps = createDeps({ processRunner: runner, filesystem: fs });
      const result = restoreInstance(deps, "mysite", "/backups");

      expect(result.exitCode).toBe(0);
      const headerCall = runner.recordedCalls.find(
        (c) => c.command[0] === "bash" && c.command[2]?.includes("zcat"),
      );
      expect(headerCall?.command[2]).toContain("dump.sql.gz");
    });

    test("warns if no database dump found", () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/mysite");
      fs.addDirectory("/backups");
      fs.setDirFiles("/backups", []);

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });

      const deps = createDeps({ processRunner: runner, filesystem: fs });
      const result = restoreInstance(deps, "mysite", "/backups");

      expect(result.exitCode).toBe(0);
      expect(result.warnings).toContain("No database backup found");
    });
  });

  describe("table prefix", () => {
    test("parses UpdraftPlus header and updates wp-config.php", () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/mysite");
      fs.addDirectory("/backups");
      fs.setDirFiles("/backups", ["backup_2024-01-01-db.gz"]);

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });
      // Header with table prefix
      runner.addResponse(["bash", "-c"], {
        exitCode: 0,
        stdout: "# WordPress MySQL database backup\n# Table prefix: wp_custom_\n# -----\n",
      });
      runner.addResponse(["sudo", "sed"], { exitCode: 0 });
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      runner.addResponse(["bash", "-c"], { exitCode: 0 });

      const deps = createDeps({ processRunner: runner, filesystem: fs });
      const result = restoreInstance(deps, "mysite", "/backups");

      expect(result.exitCode).toBe(0);

      const sedCall = runner.recordedCalls.find(
        (c) => c.command[0] === "sudo" && c.command[1] === "sed",
      );
      expect(sedCall).toBeDefined();
      expect(sedCall?.command[3]).toContain("wp_custom_");
      expect(sedCall?.command[4]).toBe("/home/user/wod/mysite/site/wp-config.php");
    });

    test("skips table prefix update when no prefix found in header", () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/mysite");
      fs.addDirectory("/backups");
      fs.setDirFiles("/backups", ["backup_2024-01-01-db.gz"]);

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });
      runner.addResponse(["bash", "-c"], {
        exitCode: 0,
        stdout: "# Just a regular SQL dump\n",
      });
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      runner.addResponse(["bash", "-c"], { exitCode: 0 });

      const deps = createDeps({ processRunner: runner, filesystem: fs });
      const result = restoreInstance(deps, "mysite", "/backups");

      expect(result.exitCode).toBe(0);
      const sedCall = runner.recordedCalls.find(
        (c) => c.command[0] === "sudo" && c.command[1] === "sed",
      );
      expect(sedCall).toBeUndefined();
    });
  });

  describe("database import", () => {
    test("runs the sed/import pipeline with correct transformations", () => {
      const fs = new MockFilesystem();
      fs.addDirectory("/home/user/wod/mysite");
      fs.addDirectory("/backups");
      fs.setDirFiles("/backups", ["backup_2024-01-01-db.gz"]);

      const runner = new MockProcessRunner();
      runner.addResponse(["sudo", "chown"], { exitCode: 0 });
      runner.addResponse(["bash", "-c"], { exitCode: 0, stdout: "# no header\n" });
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      runner.addResponse(["bash", "-c"], { exitCode: 0 });

      const deps = createDeps({ processRunner: runner, filesystem: fs });
      restoreInstance(deps, "mysite", "/backups");

      // Find the db import pipeline call (second bash -c call)
      const bashCalls = runner.recordedCalls.filter(
        (c) => c.command[0] === "bash" && c.command[1] === "-c",
      );
      expect(bashCalls.length).toBeGreaterThanOrEqual(2);
      const importCall = bashCalls[bashCalls.length - 1];
      const pipeline = importCall.command[2];

      expect(pipeline).toContain("zcat");
      expect(pipeline).toContain("sed");
      expect(pipeline).toContain("wp db import -");
      expect(pipeline).toContain("sql_mode");
      expect(pipeline).toContain("/^\\/\\*M!/d");
    });
  });

  describe("full success path", () => {
    test("all content types + DB restored returns exitCode 0", () => {
      const fs = new MockFilesystem();
      setupFilesystemWithBackups(fs);
      fs.addDirectory("/home/user/wod/mysite/site/wp-content/plugins");
      fs.addDirectory("/home/user/wod/mysite/site/wp-content/themes");
      fs.addDirectory("/home/user/wod/mysite/site/wp-content/uploads");
      fs.addDirectory("/home/user/wod/mysite/site/wp-content/others");
      const runner = setupSuccessRunner();
      const deps = createDeps({ processRunner: runner, filesystem: fs });
      const result = restoreInstance(deps, "mysite", "/backups");

      expect(result.exitCode).toBe(0);
      expect(result.error).toBeNull();
      expect(result.warnings).toHaveLength(0);
    });
  });
});
