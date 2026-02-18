import type { CreateConfig } from "../config/create-config.ts";

export function patchDockerfile(content: string, config: CreateConfig): string {
  const tag = `${config.wordpressVersion}-php${config.phpVersion}-apache`;
  return content.replace(/^FROM\s+wordpress:.*$/m, `FROM wordpress:${tag}`);
}

export function patchDockerCompose(content: string, config: CreateConfig): string {
  const customTag = `${config.wordpressVersion}-php${config.phpVersion}-custom`;
  return content
    .replace(/^(\s*)image:\s*mysql:.*$/m, `$1image: mysql:${config.mysqlVersion}`)
    .replace(/^(\s*)image:\s*wordpress:.*$/m, `$1image: wordpress:${customTag}`);
}
