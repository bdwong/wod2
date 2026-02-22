import * as path from "node:path";
import type { WodConfig } from "../config/config.ts";
import { targetDir } from "../config/config.ts";
import type { CreateConfig } from "../config/create-config.ts";
import { containerExists, volumeExists } from "../docker/docker.ts";
import type { ProcessRunner } from "../docker/process-runner.ts";
import {
  DEFAULT_INI_TEMPLATE,
  DOCKER_COMPOSE_TEMPLATE,
  DOCKERFILE_TEMPLATE,
} from "../templates/php82-template.ts";
import { patchDockerCompose, patchDockerfile } from "../templates/template-patcher.ts";
import type { Filesystem } from "../utils/filesystem.ts";
import { restoreInstance } from "./restore.ts";

export interface CreateDependencies {
  processRunner: ProcessRunner;
  filesystem: Filesystem;
  config: WodConfig;
  createConfig: CreateConfig;
  sleep: (ms: number) => Promise<void>;
}

export interface CreateResult {
  exitCode: number;
  siteUrl: string | null;
  adminPassword: string | null;
  error: string | null;
}

export async function createInstance(
  deps: CreateDependencies,
  name: string,
  backupDir?: string,
): Promise<CreateResult> {
  const { processRunner, filesystem, config, createConfig, sleep } = deps;
  const instanceDir = targetDir(config, name);

  // Prerequisite checks
  if (filesystem.isDirectory(instanceDir)) {
    return {
      exitCode: 1,
      siteUrl: null,
      adminPassword: null,
      error: `Directory already exists: ${instanceDir}`,
    };
  }

  if (containerExists(processRunner, name, "wordpress")) {
    return {
      exitCode: 1,
      siteUrl: null,
      adminPassword: null,
      error: `Docker container already exists for ${name} wordpress`,
    };
  }

  if (containerExists(processRunner, name, "db")) {
    return {
      exitCode: 1,
      siteUrl: null,
      adminPassword: null,
      error: `Docker container already exists for ${name} db`,
    };
  }

  if (volumeExists(processRunner, `${name}_db_data`)) {
    return {
      exitCode: 1,
      siteUrl: null,
      adminPassword: null,
      error: `Docker volume already exists: ${name}_db_data`,
    };
  }

  if (backupDir && !filesystem.isDirectory(backupDir)) {
    return {
      exitCode: 1,
      siteUrl: null,
      adminPassword: null,
      error: `Backup directory does not exist: ${backupDir}`,
    };
  }

  // Write template files to instance directory
  filesystem.ensureDirectory(instanceDir);
  filesystem.ensureDirectory(path.join(instanceDir, "wp-php-custom"));

  const patchedCompose = patchDockerCompose(DOCKER_COMPOSE_TEMPLATE, createConfig);
  const patchedDockerfile = patchDockerfile(DOCKERFILE_TEMPLATE, createConfig);

  filesystem.writeFile(path.join(instanceDir, "docker-compose.yml"), patchedCompose);
  filesystem.writeFile(path.join(instanceDir, "wp-php-custom", "Dockerfile"), patchedDockerfile);
  filesystem.writeFile(
    path.join(instanceDir, "wp-php-custom", "default.ini"),
    DEFAULT_INI_TEMPLATE,
  );

  // docker compose up -d
  const composeResult = processRunner.run(["docker", "compose", "up", "-d"], { cwd: instanceDir });
  if (composeResult.exitCode !== 0) {
    return {
      exitCode: composeResult.exitCode,
      siteUrl: null,
      adminPassword: null,
      error: `docker compose up failed: ${composeResult.stderr}`,
    };
  }

  // Wait for DB startup
  await sleep(10000);

  // Find WordPress container
  const containerLsResult = processRunner.run([
    "docker",
    "container",
    "ls",
    "-qf",
    `name=${name}-wordpress-`,
  ]);
  const containerId = containerLsResult.stdout.trim();
  if (!containerId) {
    return {
      exitCode: 1,
      siteUrl: null,
      adminPassword: null,
      error: "WordPress container not found after compose up",
    };
  }

  // Extract WORDPRESS_* env vars from the running container
  const envResult = processRunner.run(["docker", "exec", containerId, "/bin/env"]);
  const wpEnvVars = envResult.stdout.split("\n").filter((line) => line.startsWith("WORDPRESS"));

  // wp core install
  const wpResult = processRunner.run([
    "docker",
    "run",
    "--rm",
    ...wpEnvVars.flatMap((v) => ["--env", v]),
    "--volumes-from",
    containerId,
    "--network",
    `container:${containerId}`,
    "--user",
    "33:33",
    "wordpress:cli",
    "wp",
    "core",
    "install",
    `--url=${createConfig.siteUrl}`,
    "--title=Testing WordPress",
    "--admin_user=admin",
    "--admin_email=admin@127.0.0.1",
  ]);

  if (wpResult.exitCode !== 0) {
    return {
      exitCode: wpResult.exitCode,
      siteUrl: null,
      adminPassword: null,
      error: `wp core install failed: ${wpResult.stderr}`,
    };
  }

  // Extract admin password from wp core install output
  const passwordMatch = wpResult.stdout.match(/^Admin password:\s*(.+)$/m);
  const adminPassword = passwordMatch ? passwordMatch[1].trim() : null;

  // Restore backup if backupDir was provided
  if (backupDir) {
    const restoreResult = restoreInstance({ processRunner, filesystem, config }, name, backupDir);
    if (restoreResult.exitCode !== 0) {
      return {
        exitCode: restoreResult.exitCode,
        siteUrl: null,
        adminPassword,
        error: restoreResult.error,
      };
    }

    // Update site URL after restore
    const envFlags = wpEnvVars.flatMap((v) => ["--env", v]);
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
      createConfig.siteUrl,
    ]);
    if (siteUrlResult.exitCode !== 0) {
      return {
        exitCode: siteUrlResult.exitCode,
        siteUrl: null,
        adminPassword,
        error: `Failed to set siteurl: ${siteUrlResult.stderr}`,
      };
    }

    const homeResult = processRunner.run([
      ...wpCliBase,
      "option",
      "set",
      "home",
      createConfig.siteUrl,
    ]);
    if (homeResult.exitCode !== 0) {
      return {
        exitCode: homeResult.exitCode,
        siteUrl: null,
        adminPassword,
        error: `Failed to set home URL: ${homeResult.stderr}`,
      };
    }
  }

  return { exitCode: 0, siteUrl: createConfig.siteUrl, adminPassword, error: null };
}
