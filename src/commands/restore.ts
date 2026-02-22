import * as path from "node:path";
import type { WodConfig } from "../config/config.ts";
import { targetDir } from "../config/config.ts";
import type { ProcessRunner } from "../docker/process-runner.ts";
import type { Filesystem } from "../utils/filesystem.ts";

export interface RestoreDependencies {
  processRunner: ProcessRunner;
  filesystem: Filesystem;
  config: WodConfig;
}

export interface RestoreResult {
  exitCode: number;
  error: string | null;
  warnings: string[];
}

const CONTENT_TYPES = ["plugins", "themes", "uploads", "others"] as const;

export function restoreInstance(
  deps: RestoreDependencies,
  name: string,
  backupDir: string,
): RestoreResult {
  const { processRunner, filesystem, config } = deps;
  const instanceDir = targetDir(config, name);
  const warnings: string[] = [];

  // Validate instance directory exists
  if (!filesystem.isDirectory(instanceDir)) {
    return { exitCode: 1, error: `Instance directory does not exist: ${instanceDir}`, warnings };
  }

  // Validate backup directory exists
  if (!filesystem.isDirectory(backupDir)) {
    return { exitCode: 1, error: `Backup directory does not exist: ${backupDir}`, warnings };
  }

  // Restore content archives
  for (const contentType of CONTENT_TYPES) {
    const pattern = `backup*-${contentType}*.zip`;
    const zipFiles = filesystem.globFiles(backupDir, pattern);

    if (zipFiles.length === 0) {
      warnings.push(`No ${contentType} backup found (${pattern})`);
      continue;
    }

    // Remove existing wp-content subdirectory
    const wpContentSubdir = path.join(instanceDir, "site", "wp-content", contentType);
    if (filesystem.isDirectory(wpContentSubdir)) {
      const rmResult = processRunner.run(["sudo", "rm", "-rf", wpContentSubdir]);
      if (rmResult.exitCode !== 0) {
        return {
          exitCode: rmResult.exitCode,
          error: `Failed to remove ${wpContentSubdir}: ${rmResult.stderr}`,
          warnings,
        };
      }
    }

    // Extract each zip file
    for (const zipFile of zipFiles) {
      const zipPath = path.join(backupDir, zipFile);
      const extractResult = processRunner.run([
        "sudo",
        "unzip",
        "-od",
        path.join(instanceDir, "site", "wp-content"),
        zipPath,
      ]);
      if (extractResult.exitCode !== 0) {
        return {
          exitCode: extractResult.exitCode,
          error: `Failed to extract ${zipPath}: ${extractResult.stderr}`,
          warnings,
        };
      }
    }
  }

  // Fix permissions
  const chownResult = processRunner.run([
    "sudo",
    "chown",
    "-R",
    "www-data:www-data",
    path.join(instanceDir, "site", "wp-content"),
  ]);
  if (chownResult.exitCode !== 0) {
    return {
      exitCode: chownResult.exitCode,
      error: `Failed to fix permissions: ${chownResult.stderr}`,
      warnings,
    };
  }

  // Restore database
  let dbFile: string | null = null;
  const dbGzFiles = filesystem.globFiles(backupDir, "backup*-db.gz");
  if (dbGzFiles.length > 0) {
    dbFile = dbGzFiles[0];
  } else {
    const sqlGzFiles = filesystem.globFiles(backupDir, "*.sql.gz");
    if (sqlGzFiles.length > 0) {
      dbFile = sqlGzFiles[0];
    }
  }

  if (!dbFile) {
    warnings.push("No database backup found");
    return { exitCode: 0, error: null, warnings };
  }

  const dbPath = path.join(backupDir, dbFile);

  // Parse UpdraftPlus header for table_prefix
  const headerResult = processRunner.run(["bash", "-c", `zcat "${dbPath}" | head -50`]);

  let tablePrefix: string | null = null;
  if (headerResult.exitCode === 0) {
    const lines = headerResult.stdout.split("\n");
    for (const line of lines) {
      if (!line.startsWith("#")) break;
      const match = line.match(/^#\s*Table prefix:\s*(.+)$/i);
      if (match) {
        tablePrefix = match[1].trim();
        break;
      }
    }
  }

  // Update table prefix in wp-config.php if found
  if (tablePrefix) {
    const wpConfigPath = path.join(instanceDir, "site", "wp-config.php");
    const sedResult = processRunner.run([
      "sudo",
      "sed",
      "-i",
      `s/\\$table_prefix = '[^']*'/\\$table_prefix = '${tablePrefix}'/`,
      wpConfigPath,
    ]);
    if (sedResult.exitCode !== 0) {
      return {
        exitCode: sedResult.exitCode,
        error: `Failed to update table prefix: ${sedResult.stderr}`,
        warnings,
      };
    }
  }

  // Find WordPress container for wp db import
  const containerLsResult = processRunner.run([
    "docker",
    "container",
    "ls",
    "-qf",
    `name=${name}-wordpress-`,
  ]);
  const containerId = containerLsResult.stdout.trim();
  if (!containerId) {
    return { exitCode: 1, error: "WordPress container not found", warnings };
  }

  // Extract WORDPRESS_* env vars from the running container
  const envResult = processRunner.run(["docker", "exec", containerId, "/bin/env"]);
  const wpEnvVars = envResult.stdout.split("\n").filter((line) => line.startsWith("WORDPRESS"));
  const envFlags = wpEnvVars.flatMap((v) => ["--env", v]);

  // Import database with sed transformations
  const sedTransforms = [
    "/^# -----/a\\/*!40101 SET sql_mode=\\'ONLY_FULL_GROUP_BY,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION\\' */;",
    "/^\\/\\*M!/d",
  ];
  const sedArgs = sedTransforms.map((t) => `-e '${t}'`).join(" ");

  const importResult = processRunner.run([
    "bash",
    "-c",
    `zcat "${dbPath}" | sed ${sedArgs} | docker run --rm -i ${envFlags.map((f) => `"${f}"`).join(" ")} --volumes-from "${containerId}" --network "container:${containerId}" --user 33:33 wordpress:cli wp db import -`,
  ]);

  if (importResult.exitCode !== 0) {
    return {
      exitCode: importResult.exitCode,
      error: `Database import failed: ${importResult.stderr}`,
      warnings,
    };
  }

  return { exitCode: 0, error: null, warnings };
}
