import { getWordPressEnvVars } from "../docker/docker.ts";
import type { ProcessRunner } from "../docker/process-runner.ts";

export interface WpDependencies {
  processRunner: ProcessRunner;
  isTTY: boolean;
}

export interface WpCommandResult {
  dockerCommand: string[] | null;
  exitCode: number;
  error: string | null;
}

function findWordPressContainer(processRunner: ProcessRunner, name: string): string | null {
  // Try with original name
  const result = processRunner.run(["docker", "container", "ls", "-qf", `name=${name}-wordpress-`]);
  const containerId = result.stdout.trim();
  if (containerId) return containerId;

  // Fallback: try with hyphens stripped from name
  const strippedName = name.replace(/-/g, "");
  if (strippedName !== name) {
    const fallback = processRunner.run([
      "docker",
      "container",
      "ls",
      "-qf",
      `name=${strippedName}-wordpress-`,
    ]);
    const fallbackId = fallback.stdout.trim();
    if (fallbackId) return fallbackId;
  }

  return null;
}

export function buildWpCommand(
  deps: WpDependencies,
  name: string,
  wpArgs: string[],
): WpCommandResult {
  const { processRunner, isTTY } = deps;

  const containerId = findWordPressContainer(processRunner, name);
  if (!containerId) {
    return {
      dockerCommand: null,
      exitCode: 1,
      error: `No running WordPress container found for ${name}`,
    };
  }

  const envFlags = getWordPressEnvVars(processRunner, containerId).flatMap((v) => ["--env", v]);

  // Build docker run command
  const inputFlags = isTTY ? ["-it"] : ["-i"];
  const dockerCommand = [
    "docker",
    "run",
    ...inputFlags,
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
    ...wpArgs,
  ];

  return { dockerCommand, exitCode: 0, error: null };
}
