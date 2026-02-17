export interface InstanceInfo {
  name: string;
  dbRunning: boolean;
  wpRunning: boolean;
  siteUrl: string | null;
}

export interface LsResult {
  instances: InstanceInfo[];
  dockerRunning: boolean;
}

export function formatLsOutput(result: LsResult): string {
  if (result.instances.length === 0) {
    return "No wod instances found.";
  }

  const lines: string[] = [];
  lines.push("d w |");
  lines.push("b p | name");
  lines.push("====#=========================");

  for (const inst of result.instances) {
    const dbChar = !result.dockerRunning ? "E" : inst.dbRunning ? "*" : ".";
    const wpChar = !result.dockerRunning ? "E" : inst.wpRunning ? "*" : ".";
    const suffix = inst.siteUrl ? ` at ${inst.siteUrl}` : "";
    lines.push(`${dbChar} ${wpChar} | ${inst.name}${suffix}`);
  }

  return lines.join("\n");
}
