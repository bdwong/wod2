import * as os from "node:os";
import * as path from "node:path";

export interface WodConfig {
  wodHome: string;
}

export function resolveConfig(overrides?: Partial<WodConfig>): WodConfig {
  const wodHome = overrides?.wodHome ?? process.env.WOD_HOME ?? path.join(os.homedir(), "wod");
  return { wodHome };
}

export function targetDir(config: WodConfig, name: string): string {
  return path.join(config.wodHome, name);
}
