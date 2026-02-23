import type { CreateConfig } from "../config/create-config.ts";
import { wordpressCustomImageTag, wordpressTag } from "../config/create-config.ts";

export interface TemplateVars {
  wordpressVersion: string;
  phpVersion: string;
  mysqlVersion: string;
  wordpressTag: string;
  wordpressCustomImageTag: string;
}

export function buildTemplateVars(config: CreateConfig): TemplateVars {
  return {
    wordpressVersion: config.wordpressVersion,
    phpVersion: config.phpVersion,
    mysqlVersion: config.mysqlVersion,
    wordpressTag: wordpressTag(config),
    wordpressCustomImageTag: wordpressCustomImageTag(config),
  };
}
