export interface CreateConfig {
  wordpressVersion: string;
  phpVersion: string;
  mysqlVersion: string;
  templateName: string;
  httpPort: number;
  httpsPort: number;
  siteUrl: string;
}

export function resolveCreateConfig(overrides?: Partial<CreateConfig>): CreateConfig {
  const httpPort = Number(overrides?.httpPort ?? process.env.HTTP_PORT ?? 8000);
  const httpsPort = Number(overrides?.httpsPort ?? process.env.HTTPS_PORT ?? 8443);
  return {
    wordpressVersion: overrides?.wordpressVersion ?? process.env.WORDPRESS_VERSION ?? "6.9.1",
    phpVersion: overrides?.phpVersion ?? process.env.PHP_VERSION ?? "8.5",
    mysqlVersion: overrides?.mysqlVersion ?? process.env.MYSQL_VERSION ?? "5.7",
    templateName: overrides?.templateName ?? process.env.TEMPLATE_NAME ?? "custom",
    httpPort,
    httpsPort,
    siteUrl: overrides?.siteUrl ?? process.env.SITEURL ?? `https://127.0.0.1:${httpsPort}`,
  };
}

export function wordpressTag(config: CreateConfig): string {
  return `${config.wordpressVersion}-php${config.phpVersion}-apache`;
}

export function wordpressCustomImageTag(config: CreateConfig): string {
  return `${config.wordpressVersion}-php${config.phpVersion}-custom`;
}
