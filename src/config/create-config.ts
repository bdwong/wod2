export interface CreateConfig {
  wordpressVersion: string;
  phpVersion: string;
  mysqlVersion: string;
  templateName: string;
  siteUrl: string;
}

export function resolveCreateConfig(overrides?: Partial<CreateConfig>): CreateConfig {
  return {
    wordpressVersion: overrides?.wordpressVersion ?? process.env.WORDPRESS_VERSION ?? "6.7.1",
    phpVersion: overrides?.phpVersion ?? process.env.PHP_VERSION ?? "8.2",
    mysqlVersion: overrides?.mysqlVersion ?? process.env.MYSQL_VERSION ?? "5.7",
    templateName: overrides?.templateName ?? process.env.TEMPLATE_NAME ?? "php8.2",
    siteUrl: overrides?.siteUrl ?? process.env.SITEURL ?? "http://127.0.0.1:8000",
  };
}

export function wordpressTag(config: CreateConfig): string {
  return `${config.wordpressVersion}-php${config.phpVersion}-apache`;
}

export function wordpressCustomImageTag(config: CreateConfig): string {
  return `${config.wordpressVersion}-php${config.phpVersion}-custom`;
}
