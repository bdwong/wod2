import { targetDir, type WodConfig } from "../config/config.ts";
import type { ProcessRunner } from "../docker/process-runner.ts";
import type { Filesystem } from "../utils/filesystem.ts";

export interface DownDependencies {
  processRunner: ProcessRunner;
  filesystem: Filesystem;
  config: WodConfig;
}

export interface DownResult {
  exitCode: number;
}

export function downInstance(deps: DownDependencies, name: string): DownResult {
  const { processRunner, filesystem, config } = deps;
  const instanceDir = targetDir(config, name);

  if (!filesystem.isDirectory(instanceDir)) {
    return { exitCode: 1 };
  }

  const result = processRunner.run(["docker", "compose", "down"], {
    cwd: instanceDir,
  });

  return { exitCode: result.exitCode };
}
