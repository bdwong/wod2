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

  // Extract WORDPRESS_* env vars from the running container
  const envResult = runner.run(["docker", "exec", containerId, "/bin/env"]);
  const wpEnvVars = envResult.stdout.split("\n").filter((line) => line.startsWith("WORDPRESS"));

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
