import type { WodConfig } from "../config/config.ts";
import { containerIsRunning, dockerIsRunning, querySiteUrl } from "../docker/docker.ts";
import type { ProcessRunner } from "../docker/process-runner.ts";
import type { Filesystem } from "../utils/filesystem.ts";
import type { InstanceInfo, LsResult } from "./ls-formatter.ts";

export interface LsDependencies {
  processRunner: ProcessRunner;
  filesystem: Filesystem;
  config: WodConfig;
}

export function listInstances(deps: LsDependencies): LsResult {
  const { processRunner, filesystem, config } = deps;

  // Ensure WOD_HOME exists
  filesystem.ensureDirectory(config.wodHome);

  // Get instance directories
  const instanceNames = filesystem.listSubdirectories(config.wodHome);

  if (instanceNames.length === 0) {
    return { instances: [], dockerRunning: false };
  }

  // Check Docker status once
  const isDockerRunning = dockerIsRunning(processRunner);

  const instances: InstanceInfo[] = instanceNames.map((name) => {
    if (!isDockerRunning) {
      return { name, dbRunning: false, wpRunning: false, siteUrl: null };
    }

    const dbRunning = containerIsRunning(processRunner, name, "db");
    const wpRunning = containerIsRunning(processRunner, name, "wordpress");

    let siteUrl: string | null = null;
    if (dbRunning && wpRunning) {
      siteUrl = querySiteUrl(processRunner, name);
    }

    return { name, dbRunning, wpRunning, siteUrl };
  });

  return { instances, dockerRunning: isDockerRunning };
}
