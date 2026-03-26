import * as fs from "node:fs";
import * as path from "node:path";
import { createGunzip } from "node:zlib";
import type { WodConfig } from "../config/config.ts";
import { targetDir } from "../config/config.ts";
import { getWordPressEnvVars } from "../docker/docker.ts";
import type { ProcessRunner } from "../docker/process-runner.ts";
import type { Filesystem } from "../utils/filesystem.ts";

export interface RestoreOptions {
  keepUrls?: boolean;
  siteUrl?: string;
}

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

const SQL_MODE_DIRECTIVE =
  "/*!40101 SET sql_mode='ONLY_FULL_GROUP_BY,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */;";

/**
 * Transform SQL dump content:
 * - Remove lines starting with /​*M! (MariaDB directives)
 * - After lines starting with # -----, insert SQL mode directive
 */
export function transformSql(sql: string): string {
  const lines = sql.split("\n");
  const result: string[] = [];
  for (const line of lines) {
    if (line.startsWith("/*M!")) continue;
    result.push(line);
    if (line.startsWith("# -----")) {
      result.push(SQL_MODE_DIRECTIVE);
    }
  }
  return result.join("\n");
}

/**
 * Read the first N lines from a gzipped file using Node.js streams.
 */
function readGzipHeader(filePath: string, maxLines: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = fs.createReadStream(filePath);
    const gunzip = createGunzip();
    const chunks: Buffer[] = [];
    let lineCount = 0;
    let done = false;

    const stream = input.pipe(gunzip);

    stream.on("data", (chunk: Buffer) => {
      if (done) return;
      chunks.push(chunk);
      const text = Buffer.concat(chunks).toString("utf-8");
      lineCount = text.split("\n").length - 1;
      if (lineCount >= maxLines) {
        done = true;
        stream.destroy();
        input.destroy();
        const lines = text.split("\n").slice(0, maxLines);
        resolve(lines.join("\n"));
      }
    });

    stream.on("end", () => {
      if (!done) {
        resolve(Buffer.concat(chunks).toString("utf-8"));
      }
    });

    stream.on("error", (err: Error) => {
      if (!done) {
        reject(err);
      }
    });
  });
}

/**
 * Create a ReadableStream from a gzipped file that decompresses and transforms the SQL.
 */
function createTransformedSqlStream(filePath: string): ReadableStream {
  const input = fs.createReadStream(filePath);
  const gunzip = createGunzip();
  const nodeStream = input.pipe(gunzip);

  const NEWLINE = 0x0a;
  const sqlModeBytes = new TextEncoder().encode(`${SQL_MODE_DIRECTIVE}\n`);
  let remainder = Buffer.alloc(0);

  return new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer) => {
        const buf = remainder.length > 0 ? Buffer.concat([remainder, chunk]) : chunk;
        let start = 0;
        for (let i = 0; i < buf.length; i++) {
          if (buf[i] === NEWLINE) {
            const line = buf.subarray(start, i + 1); // includes the newline
            // Only inspect short lines starting with known prefixes (ASCII-safe check)
            // 0x2f = '/', 0x2a = '*', 0x4d = 'M', 0x21 = '!'
            if (line.length >= 4 && line[0] === 0x2f && line[1] === 0x2a && line[2] === 0x4d && line[3] === 0x21) {
              // Skip /*M! MariaDB directives
            } else {
              controller.enqueue(line);
              // 0x23 = '#', 0x20 = ' ', 0x2d = '-'
              if (line.length >= 7 && line[0] === 0x23 && line[1] === 0x20 && line[2] === 0x2d && line[3] === 0x2d && line[4] === 0x2d && line[5] === 0x2d && line[6] === 0x2d) {
                controller.enqueue(sqlModeBytes);
              }
            }
            start = i + 1;
          }
        }
        remainder = start < buf.length ? Buffer.from(buf.subarray(start)) : Buffer.alloc(0);
      });

      nodeStream.on("end", () => {
        if (remainder.length > 0) {
          // Flush last line (no trailing newline)
          if (!(remainder.length >= 4 && remainder[0] === 0x2f && remainder[1] === 0x2a && remainder[2] === 0x4d && remainder[3] === 0x21)) {
            controller.enqueue(remainder);
          }
        }
        controller.close();
      });

      nodeStream.on("error", (err: Error) => {
        controller.error(err);
      });
    },
    cancel() {
      nodeStream.destroy();
      input.destroy();
    },
  });
}

export async function restoreInstance(
  deps: RestoreDependencies,
  name: string,
  backupDir: string,
  options?: RestoreOptions,
): Promise<RestoreResult> {
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

  // Parse UpdraftPlus header for table_prefix using in-process gzip decompression
  let tablePrefix: string | null = null;
  try {
    const headerText = await readGzipHeader(dbPath, 50);
    const lines = headerText.split("\n");
    for (const line of lines) {
      if (!line.startsWith("#")) break;
      const match = line.match(/^#\s*Table prefix:\s*(.+)$/i);
      if (match) {
        tablePrefix = match[1].trim();
        break;
      }
    }
  } catch {
    // If we can't read the header, continue without table prefix
  }
  // Update table prefix directly in wp-config.php rather than setting
  // WORDPRESS_TABLE_PREFIX in the Docker environment. Unlike DB credentials
  // (which are correct as-is), the table prefix must change per-backup.
  // Writing to wp-config.php takes effect immediately; setting an env var
  // would require a container restart and waiting for MySQL to be ready again.
  if (tablePrefix) {
    const wpConfigPath = path.join(instanceDir, "site", "wp-config.php");
    const catResult = processRunner.run(["sudo", "cat", wpConfigPath]);
    if (catResult.exitCode !== 0) {
      return {
        exitCode: catResult.exitCode,
        error: `Failed to read wp-config.php: ${catResult.stderr}`,
        warnings,
      };
    }
    // Match both static format: $table_prefix = 'wp_'
    // and Docker format: $table_prefix = getenv_docker('WORDPRESS_TABLE_PREFIX', 'wp_')
    const prefixPattern =
      /\$table_prefix\s*=\s*(?:getenv_docker\(\s*'WORDPRESS_TABLE_PREFIX'\s*,\s*'[^']*'\s*\)|'[^']*')\s*;/;
    const replacement = `$table_prefix = '${tablePrefix}';`;
    const updatedContent = catResult.stdout.replace(prefixPattern, replacement);
    if (updatedContent === catResult.stdout) {
      warnings.push("Could not find table_prefix line in wp-config.php to update");
    }
    const teeResult = processRunner.run(["sudo", "tee", wpConfigPath], { stdin: updatedContent });
    if (teeResult.exitCode !== 0) {
      return {
        exitCode: teeResult.exitCode,
        error: `Failed to update table prefix: ${teeResult.stderr}`,
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

  const envFlags = getWordPressEnvVars(processRunner, containerId).flatMap((v) => ["--env", v]);

  // Import database with in-process streaming decompression and transformation
  const sqlStream = createTransformedSqlStream(dbPath);

  const importResult = await processRunner.runAsync(
    [
      "docker",
      "run",
      "--rm",
      "-i",
      ...envFlags,
      "--volumes-from",
      containerId,
      "--network",
      `container:${containerId}`,
      "--user",
      "33:33",
      "wordpress:cli",
      "wp",
      "db",
      "import",
      "-",
    ],
    { stdin: sqlStream },
  );

  if (importResult.exitCode !== 0) {
    return {
      exitCode: importResult.exitCode,
      error: `Database import failed: ${importResult.stderr}`,
      warnings,
    };
  }

  // Rewrite site URL after DB import (unless --keep-urls was specified)
  if (options?.siteUrl && !options?.keepUrls) {
    const wpCliBase = [
      "docker",
      "run",
      "--rm",
      ...envFlags,
      "--volumes-from",
      containerId,
      "--network",
      `container:${containerId}`,
      "--user",
      "33:33",
      "wordpress:cli",
      "wp",
    ];

    const siteUrlResult = processRunner.run([
      ...wpCliBase,
      "option",
      "set",
      "siteurl",
      options.siteUrl,
    ]);
    if (siteUrlResult.exitCode !== 0) {
      return {
        exitCode: siteUrlResult.exitCode,
        error: `Failed to set siteurl: ${siteUrlResult.stderr}`,
        warnings,
      };
    }

    const homeResult = processRunner.run([...wpCliBase, "option", "set", "home", options.siteUrl]);
    if (homeResult.exitCode !== 0) {
      return {
        exitCode: homeResult.exitCode,
        error: `Failed to set home URL: ${homeResult.stderr}`,
        warnings,
      };
    }
  }

  return { exitCode: 0, error: null, warnings };
}
