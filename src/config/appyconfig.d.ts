declare module "appyconfig" {
  interface ConfigResolverOptions {
    keyCase?: string | null;
    locked?: boolean;
  }

  interface LoaderOptions {
    prefix?: string | null;
    stripPrefix?: boolean;
    expand?: boolean;
  }

  interface FileLoaderOptions {
    allowMissing?: boolean;
    suppressExceptions?: boolean;
  }

  class ValueLoader {
    mapKey: string | null;
  }

  class DefaultValueLoader extends ValueLoader {
    constructor();
  }

  class EnvLoader extends ValueLoader {
    constructor(options?: LoaderOptions);
  }

  class CmdArgsLoader extends ValueLoader {
    constructor();
    setCommand(command: unknown): void;
  }

  class JsonLoader extends ValueLoader {
    constructor(filename: string, options?: FileLoaderOptions | boolean);
  }

  class DotenvLoader extends ValueLoader {
    constructor(filename: string, options?: FileLoaderOptions | boolean);
  }

  class YamlLoader extends ValueLoader {
    constructor(filename: string, options?: FileLoaderOptions | boolean);
  }

  class TomlLoader extends ValueLoader {
    constructor(filename: string, options?: FileLoaderOptions | boolean);
  }

  class ArgvLoader extends ValueLoader {
    static EXIT: symbol;
    static THROW: symbol;
    static IGNORE: symbol;
    constructor(options?: {
      aliases?: Record<string, string>;
      onUnrecognized?: symbol | ((arg: string) => void);
    });
    loadValues(): Record<string, unknown>;
  }

  class UnrecognizedArgumentError extends Error {
    argument: string;
    constructor(argument: string);
  }

  class NullLoader extends ValueLoader {
    constructor();
  }

  type ResolveMap = ValueLoader | typeof LOCK | typeof UNLOCK;

  class ConfigResolver {
    valueTree: Record<string, unknown>;
    configTree: Record<string, unknown> | null;
    resolveMaps: ResolveMap[];

    constructor(options?: ConfigResolverOptions);
    resolveConfig(
      resolveMaps: ResolveMap[],
      configTree?: Record<string, unknown> | null,
      valueTree?: Record<string, unknown>,
    ): Record<string, unknown>;
    resolveConfig(): Record<string, unknown>;
    resolveCommander(command: unknown): void;
  }

  const LOCK: unique symbol;
  const UNLOCK: unique symbol;

  function resolveConfig(...args: unknown[]): Record<string, unknown>;
  function resolveCommander(command: unknown): void;
}
