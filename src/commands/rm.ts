import * as path from "node:path";
import type { WodConfig } from "../config/config.ts";
import { targetDir } from "../config/config.ts";
import { volumeExists } from "../docker/docker.ts";
import type { ProcessRunner } from "../docker/process-runner.ts";
import type { Filesystem } from "../utils/filesystem.ts";

export interface RmDependencies {
  processRunner: ProcessRunner;
  filesystem: Filesystem;
  config: WodConfig;
}

export interface RmResult {
  exitCode: number;
  error: string | null;
}

export function rmInstance(deps: RmDependencies, name: string): RmResult {
  const { processRunner, filesystem, config } = deps;
  const instanceDir = targetDir(config, name);

  if (!filesystem.isDirectory(instanceDir)) {
    return { exitCode: 1, error: `Instance directory does not exist: ${instanceDir}` };
  }

  // Run docker compose down if docker-compose.yml exists
  if (filesystem.fileExists(path.join(instanceDir, "docker-compose.yml"))) {
    const downResult = processRunner.run(["docker", "compose", "down"], { cwd: instanceDir });
    if (downResult.exitCode !== 0) {
      return {
        exitCode: downResult.exitCode,
        error: `docker compose down failed: ${downResult.stderr}`,
      };
    }
  }

  // Remove instance directory
  const rmResult = processRunner.run(["sudo", "rm", "-rf", instanceDir]);
  if (rmResult.exitCode !== 0) {
    return { exitCode: rmResult.exitCode, error: `Failed to remove directory: ${rmResult.stderr}` };
  }

  // Remove Docker volume if it exists
  const volumeName = `${name}_db_data`;
  if (volumeExists(processRunner, volumeName)) {
    const volumeResult = processRunner.run(["docker", "volume", "rm", volumeName]);
    if (volumeResult.exitCode !== 0) {
      return {
        exitCode: volumeResult.exitCode,
        error: `Failed to remove volume: ${volumeResult.stderr}`,
      };
    }
  }

  return { exitCode: 0, error: null };
}
