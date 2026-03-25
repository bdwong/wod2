import { configResolver, configTree, loaders } from "./config.ts";

export interface CreateConfig {
  wordpressVersion: string;
  phpVersion: string;
  mysqlVersion: string;
  templateName: string;
  httpPort: number;
  httpsPort: number;
  siteUrl: string;
  hostnames: string[];
}

function postProcessCreateConfig(raw: Record<string, unknown>): CreateConfig {
  const httpPort = Number(raw.httpPort);
  const httpsPort = Number(raw.httpsPort);
  const hostnamesRaw = raw.hostnames as string | undefined;
  const hostnames = hostnamesRaw ? hostnamesRaw.split(",").filter(Boolean) : [];
  const defaultSiteUrl =
    hostnames.length > 0
      ? `https://${hostnames[0]}:${httpsPort}`
      : `https://127.0.0.1:${httpsPort}`;
  return {
    wordpressVersion: raw.wordpressVersion as string,
    phpVersion: raw.phpVersion as string,
    mysqlVersion: raw.mysqlVersion as string,
    templateName: raw.templateName as string,
    httpPort,
    httpsPort,
    siteUrl: (raw.siteUrl as string) || defaultSiteUrl,
    hostnames,
  };
}

export function resolveConfigForCreate(overrides?: Partial<CreateConfig>): CreateConfig {
  // Re-resolve to pick up any env var or CLI arg changes
  const resolved = { ...configResolver.resolveConfig(configTree, loaders) } as Record<
    string,
    unknown
  >;

  // Apply programmatic overrides on top
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined) {
        if (key === "hostnames" && Array.isArray(value)) {
          resolved[key] = value.join(",");
        } else {
          resolved[key] = value;
        }
      }
    }
  }

  return postProcessCreateConfig(resolved);
}

export function wordpressTag(config: CreateConfig): string {
  return `${config.wordpressVersion}-php${config.phpVersion}-apache`;
}

export function wordpressCustomImageTag(config: CreateConfig): string {
  return `${config.wordpressVersion}-php${config.phpVersion}-custom`;
}
