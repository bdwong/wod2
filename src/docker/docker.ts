import type { ProcessRunner } from "./process-runner.ts";

export function dockerIsRunning(runner: ProcessRunner): boolean {
  const result = runner.run(["docker", "version"]);
  return result.exitCode === 0;
}

export function containerIsRunning(
  runner: ProcessRunner,
  instanceName: string,
  service: string,
): boolean {
  const result = runner.run([
    "docker",
    "container",
    "ls",
    "-qf",
    `name=${instanceName}-${service}-`,
  ]);
  return result.exitCode === 0 && result.stdout.trim().length > 0;
}

export function containerExists(
  runner: ProcessRunner,
  instanceName: string,
  service: string,
): boolean {
  const result = runner.run([
    "docker",
    "container",
    "ls",
    "-aqf",
    `name=${instanceName}-${service}-`,
  ]);
  return result.exitCode === 0 && result.stdout.trim().length > 0;
}

export function volumeExists(runner: ProcessRunner, volumeName: string): boolean {
  const result = runner.run(["docker", "volume", "ls", "-qf", `name=${volumeName}`]);
  return result.exitCode === 0 && result.stdout.trim().length > 0;
}

/**
 * Extract WORDPRESS_* env vars from a running container, merged with baseline defaults.
 * Baseline values ensure wp-cli can connect even if env extraction fails.
 * Extracted values override baseline when present.
 */
export function getWordPressEnvVars(runner: ProcessRunner, containerId: string): string[] {
  const envResult = runner.run(["docker", "exec", containerId, "env"]);
  const extractedEnvVars = envResult.stdout
    .split("\n")
    .filter((line) => line.startsWith("WORDPRESS"));

  const baselineEnvVars = [
    "WORDPRESS_DB_HOST=db:3306",
    "WORDPRESS_DB_USER=wordpress",
    "WORDPRESS_DB_PASSWORD=wordpress",
    "WORDPRESS_DB_NAME=wordpress",
  ];
  const envMap = new Map<string, string>();
  for (const entry of [...baselineEnvVars, ...extractedEnvVars]) {
    const eqIdx = entry.indexOf("=");
    if (eqIdx > 0) envMap.set(entry.substring(0, eqIdx), entry);
  }
  return [...envMap.values()];
}

export function querySiteUrl(runner: ProcessRunner, instanceName: string): string | null {
  // Find the running WordPress container
  const containerLsResult = runner.run([
    "docker",
    "container",
    "ls",
    "-qf",
    `name=${instanceName}-wordpress-`,
  ]);
  const containerId = containerLsResult.stdout.trim();
  if (!containerId) return null;

  const wpEnvVars = getWordPressEnvVars(runner, containerId);

  // Run wp-cli to get the siteurl
  const result = runner.run([
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
    "option",
    "get",
    "siteurl",
  ]);

  if (result.exitCode !== 0) return null;
  return result.stdout.trim() || null;
}
