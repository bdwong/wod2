import path from "node:path";
import { targetDir, type WodConfig } from "../config/config.ts";
import type { CreateConfig } from "../config/create-config.ts";
import type { ProcessRunner } from "../docker/process-runner.ts";
import type { TemplateSource } from "../templates/template-engine.ts";
import { installTemplate } from "../templates/template-engine.ts";
import { buildTemplateVars } from "../templates/template-vars.ts";
import type { Filesystem } from "../utils/filesystem.ts";

export interface UpdateDependencies {
  processRunner: ProcessRunner;
  filesystem: Filesystem;
  config: WodConfig;
  createConfig: CreateConfig;
  templateSource: TemplateSource;
}

export interface UpdateResult {
  exitCode: number;
  siteUrl: string | null;
  error: string | null;
}

export function updateInstance(deps: UpdateDependencies, name: string): UpdateResult {
  const { processRunner, filesystem, config, createConfig, templateSource } = deps;
  const instanceDir = targetDir(config, name);

  if (!filesystem.isDirectory(instanceDir)) {
    return {
      exitCode: 1,
      siteUrl: null,
      error: `Instance directory does not exist: ${instanceDir}`,
    };
  }

  // Stop containers before rebuilding
  const downResult = processRunner.run(["docker", "compose", "down"], { cwd: instanceDir });
  if (downResult.exitCode !== 0) {
    return {
      exitCode: downResult.exitCode,
      siteUrl: null,
      error: `docker compose down failed: ${downResult.stderr}`,
    };
  }

  // Re-render template files (overwrites Dockerfile, docker-compose.yml, etc.)
  const vars = buildTemplateVars(createConfig);
  installTemplate(createConfig.templateName, instanceDir, vars, filesystem, templateSource);

  // Regenerate self-signed TLS certificate
  const certDir = path.join(instanceDir, "wp-php-custom");
  const sanDns = ["localhost", ...createConfig.hostnames].map((h) => `DNS:${h}`).join(",");
  processRunner.run([
    "openssl",
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    path.join(certDir, "cert.key"),
    "-x509",
    "-days",
    "365",
    "-out",
    path.join(certDir, "cert.pem"),
    "-subj",
    "/CN=localhost",
    "-addext",
    `subjectAltName=${sanDns}`,
  ]);

  // Rebuild image and start containers
  const upResult = processRunner.run(["docker", "compose", "up", "--build", "-d"], {
    cwd: instanceDir,
  });
  if (upResult.exitCode !== 0) {
    return {
      exitCode: upResult.exitCode,
      siteUrl: null,
      error: `docker compose up failed: ${upResult.stderr}`,
    };
  }

  return { exitCode: 0, siteUrl: createConfig.siteUrl, error: null };
}
