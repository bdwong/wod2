import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import type {
  CmdArgsLoader as CmdArgsLoaderType,
  ConfigResolver as ConfigResolverType,
  DefaultValueLoader as DefaultValueLoaderType,
  EnvLoader as EnvLoaderType,
  JsonLoader as JsonLoaderType,
} from "appyconfig";

const require = createRequire(import.meta.url);
const { ConfigResolver, DefaultValueLoader, EnvLoader, JsonLoader, CmdArgsLoader } =
  require("appyconfig") as {
    ConfigResolver: new (options?: { keyCase?: string | null }) => ConfigResolverType;
    DefaultValueLoader: new () => DefaultValueLoaderType;
    EnvLoader: new () => EnvLoaderType;
    JsonLoader: new (filename: string, options?: { allowMissing?: boolean }) => JsonLoaderType;
    CmdArgsLoader: new () => CmdArgsLoaderType;
  };

export interface WodConfig {
  wodHome: string;
}

const configFilePath = path.join(os.homedir(), ".wod", "config.json");

export const configTree = {
  wodHome: { default: path.join(os.homedir(), "wod"), env: "WOD_HOME" },
  wordpressVersion: { default: "6.9.1", env: "WORDPRESS_VERSION", cmdArg: "wordpressVersion" },
  phpVersion: { default: "8.5", env: "PHP_VERSION", cmdArg: "phpVersion" },
  mysqlVersion: { default: "5.7", env: "MYSQL_VERSION", cmdArg: "mysqlVersion" },
  templateName: { default: "custom", env: "TEMPLATE_NAME", cmdArg: "template" },
  httpPort: { default: "8000", env: "HTTP_PORT", cmdArg: "httpPort" },
  httpsPort: { default: "8443", env: "HTTPS_PORT", cmdArg: "httpsPort" },
  hostnames: { default: "", env: "HOSTNAMES", cmdArg: "hostnames" },
  siteUrl: { env: "SITEURL", cmdArg: "siteUrl" },
};

export const loaders = [
  new DefaultValueLoader(),
  new JsonLoader(configFilePath, { allowMissing: true }),
  new EnvLoader(),
  new CmdArgsLoader(),
];

export const configResolver = new ConfigResolver({ keyCase: null });
export const config = configResolver.resolveConfig(loaders, configTree) as WodConfig &
  Record<string, unknown>;

export function targetDir(wodConfig: WodConfig, name: string): string {
  return path.join(wodConfig.wodHome, name);
}
