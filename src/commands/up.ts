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

export function upInstance(deps: UpDependencies, name: string): UpResult {
  const { processRunner, filesystem, config } = deps;
  const instanceDir = targetDir(config, name);

  if (!filesystem.isDirectory(instanceDir)) {
    return { exitCode: 1, siteUrl: null };
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
