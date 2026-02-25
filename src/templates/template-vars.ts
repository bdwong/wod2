import type { CreateConfig } from "../config/create-config.ts";
import { wordpressCustomImageTag, wordpressTag } from "../config/create-config.ts";

export interface TemplateVars {
  wordpressVersion: string;
  phpVersion: string;
  mysqlVersion: string;
  wordpressTag: string;
  wordpressCustomImageTag: string;
  phpGdLegacy: boolean;
  phpAvifSupported: boolean;
  phpMcryptAvailable: boolean;
}

function parsePhpMajorMinor(phpVersion: string): [number, number] {
  const [major, minor] = phpVersion.split(".").map(Number);
  return [major ?? 0, minor ?? 0];
}

export function buildTemplateVars(config: CreateConfig): TemplateVars {
  const [major, minor] = parsePhpMajorMinor(config.phpVersion);
  return {
    wordpressVersion: config.wordpressVersion,
    phpVersion: config.phpVersion,
    mysqlVersion: config.mysqlVersion,
    wordpressTag: wordpressTag(config),
    wordpressCustomImageTag: wordpressCustomImageTag(config),
    phpGdLegacy: major < 7 || (major === 7 && minor < 4),
    phpAvifSupported: major > 8 || (major === 8 && minor >= 1),
    phpMcryptAvailable: major < 7 || (major === 7 && minor < 2),
  };
}
