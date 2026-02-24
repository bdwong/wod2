import path from "node:path";
import { targetDir, type WodConfig } from "../config/config.ts";
import { querySiteUrl } from "../docker/docker.ts";
import type { ProcessRunner } from "../docker/process-runner.ts";
import type { Filesystem } from "../utils/filesystem.ts";

export interface UpDependencies {
  processRunner: ProcessRunner;
  filesystem: Filesystem;
  config: WodConfig;
}

export interface UpResult {
  exitCode: number;
  siteUrl: string | null;
}

export interface PortOverrides {
  httpPort: number;
  httpsPort: number;
}

export function upInstance(deps: UpDependencies, name: string, ports?: PortOverrides): UpResult {
  const { processRunner, filesystem, config } = deps;
  const instanceDir = targetDir(config, name);

  if (!filesystem.isDirectory(instanceDir)) {
    return { exitCode: 1, siteUrl: null };
  }

  if (ports) {
    const envContent = `HTTP_PORT=${ports.httpPort}\nHTTPS_PORT=${ports.httpsPort}\n`;
    filesystem.writeFile(path.join(instanceDir, ".env"), envContent);
  }

  const result = processRunner.run(["docker", "compose", "up", "-d"], {
    cwd: instanceDir,
  });

  if (result.exitCode !== 0) {
    return { exitCode: result.exitCode, siteUrl: null };
  }

  const siteUrl = querySiteUrl(processRunner, name);
  return { exitCode: 0, siteUrl };
}
