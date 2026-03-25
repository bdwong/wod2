import { createRequire } from "node:module";
import path from "node:path";
import { Command } from "commander";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };
import { createInstance } from "../commands/create.ts";
import { downInstance } from "../commands/down.ts";
import { installBundledTemplates } from "../commands/install.ts";
import { listInstances } from "../commands/ls.ts";
import { formatLsOutput } from "../commands/ls-formatter.ts";
import { restoreInstance } from "../commands/restore.ts";
import { rmInstance } from "../commands/rm.ts";
import { upInstance } from "../commands/up.ts";
import { updateInstance } from "../commands/update.ts";
import { buildWpCommand } from "../commands/wp.ts";
import { config, configResolver } from "../config/config.ts";
import { resolveConfigForCreate } from "../config/create-config.ts";
import { BunProcessRunner } from "../docker/process-runner.ts";
import { resolveTemplateSource } from "../templates/template-resolver.ts";
import { RealFilesystem } from "../utils/filesystem.ts";

export function validateInstanceName(name: string): string | null {
  if (/[/\\]/.test(name)) {
    return `Invalid instance name "${name}": must not contain slashes. Did you forget the instance name argument?`;
  }
  if (name.startsWith(".")) {
    return `Invalid instance name "${name}": must not start with a dot.`;
  }
  return null;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("wod")
    .description("WordPress on Docker — manage disposable WordPress instances")
    .version(version)
    .option("-v, --verbose", "Show docker commands and their output");

  program
    .command("create")
    .description("Create a new WordPress Docker instance")
    .argument("<name>", "Instance name")
    .argument("[backup-directory]", "Path to backup files to restore")
    .option("--http-port <port>", "HTTP port (default: 8000)")
    .option("--https-port <port>", "HTTPS port (default: 8443)")
    .option("--php-version <version>", "PHP version (default: 8.5)")
    .option("--wordpress-version <version>", "WordPress version (default: 6.9.1)")
    .option("--template <name>", "Template name (default: custom)")
    .option("--keep-urls", "Keep original siteurl and home from backup")
    .option(
      "--hostnames <hostnames>",
      "Comma-separated hostnames for SSL cert and container /etc/hosts",
    )
    .action(
      async (
        name: string,
        backupDirectory: string | undefined,
        options: { keepUrls?: boolean },
      ) => {
        const nameError = validateInstanceName(name);
        if (nameError) {
          console.error(nameError);
          process.exit(1);
        }
        const createConfig = resolveConfigForCreate();
        const filesystem = new RealFilesystem();
        const templateSource = resolveTemplateSource(
          createConfig.templateName,
          filesystem,
          config.wodHome,
        );
        const deps = {
          processRunner: new BunProcessRunner({ verbose: program.opts().verbose }),
          filesystem,
          config,
          createConfig,
          templateSource,
          sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
        };
        const result = await createInstance(deps, name, backupDirectory, {
          keepUrls: options.keepUrls,
        });
        if (result.error) {
          console.error(result.error);
        }
        if (result.exitCode !== 0) {
          process.exit(result.exitCode);
        }
        if (result.adminPassword) {
          console.log(`Admin password: ${result.adminPassword}`);
        }
        if (result.siteUrl) {
          console.log(`Website ready at ${result.siteUrl}`);
        }
      },
    );

  program
    .command("ls")
    .description("List all instances with status")
    .action(() => {
      const result = listInstances({
        processRunner: new BunProcessRunner({ verbose: program.opts().verbose }),
        filesystem: new RealFilesystem(),
        config,
      });
      const output = formatLsOutput(result);
      console.log(output);
    });

  program
    .command("up")
    .description("Start a stopped WordPress instance")
    .argument("<name>", "Instance name")
    .option("--http-port <port>", "HTTP port (override .env)")
    .option("--https-port <port>", "HTTPS port (override .env)")
    .action((name: string, options: { httpPort?: string; httpsPort?: string }) => {
      const nameError = validateInstanceName(name);
      if (nameError) {
        console.error(nameError);
        process.exit(1);
      }
      const deps = {
        processRunner: new BunProcessRunner({ verbose: program.opts().verbose }),
        filesystem: new RealFilesystem(),
        config,
      };
      const ports =
        options.httpPort || options.httpsPort
          ? {
              httpPort: Number(options.httpPort ?? 8000),
              httpsPort: Number(options.httpsPort ?? 8443),
            }
          : undefined;
      const result = upInstance(deps, name, ports);
      if (result.exitCode !== 0) {
        process.exit(result.exitCode);
      }
      if (result.siteUrl) {
        console.log(`Website ready at ${result.siteUrl}`);
      }
    });

  program
    .command("down")
    .description("Stop a running WordPress instance")
    .argument("<name>", "Instance name")
    .action((name: string) => {
      const nameError = validateInstanceName(name);
      if (nameError) {
        console.error(nameError);
        process.exit(1);
      }
      const deps = {
        processRunner: new BunProcessRunner({ verbose: program.opts().verbose }),
        filesystem: new RealFilesystem(),
        config,
      };
      const result = downInstance(deps, name);
      if (result.exitCode !== 0) {
        process.exit(result.exitCode);
      }
    });

  program
    .command("rm")
    .description("Remove an instance completely")
    .argument("<name>", "Instance name")
    .action((name: string) => {
      const nameError = validateInstanceName(name);
      if (nameError) {
        console.error(nameError);
        process.exit(1);
      }
      const deps = {
        processRunner: new BunProcessRunner({ verbose: program.opts().verbose }),
        filesystem: new RealFilesystem(),
        config,
      };
      console.log(`Removing ${name}`);
      const result = rmInstance(deps, name);
      if (result.error) {
        console.error(result.error);
      }
      if (result.exitCode !== 0) {
        process.exit(result.exitCode);
      }
    });

  program
    .command("update")
    .description("Update an instance with new PHP/WordPress/MySQL versions")
    .argument("<name>", "Instance name")
    .option("--php-version <version>", "PHP version")
    .option("--wordpress-version <version>", "WordPress version")
    .option("--template <name>", "Template name")
    .option(
      "--hostnames <hostnames>",
      "Comma-separated hostnames for SSL cert and container /etc/hosts",
    )
    .action((name: string, options: { hostnames?: string }) => {
      const nameError = validateInstanceName(name);
      if (nameError) {
        console.error(nameError);
        process.exit(1);
      }
      const filesystem = new RealFilesystem();
      // Preserve existing hostnames from instance .env file when not passed via CLI
      const overrides: Partial<{ hostnames: string[] }> = {};
      if (!options.hostnames) {
        const instanceDir = path.join(config.wodHome, name);
        const envPath = path.join(instanceDir, ".env");
        try {
          const envContent = filesystem.readFile(envPath);
          const hostnamesMatch = envContent.match(/^HOSTNAMES=(.+)$/m);
          if (hostnamesMatch) {
            overrides.hostnames = hostnamesMatch[1].split(",").filter(Boolean);
          }
        } catch {
          // No .env file — no hostnames to preserve
        }
      }
      const createConfig = resolveConfigForCreate(overrides);
      const templateSource = resolveTemplateSource(
        createConfig.templateName,
        filesystem,
        config.wodHome,
      );
      const deps = {
        processRunner: new BunProcessRunner({ verbose: program.opts().verbose }),
        filesystem,
        config,
        createConfig,
        templateSource,
      };
      const result = updateInstance(deps, name);
      if (result.error) {
        console.error(result.error);
      }
      if (result.exitCode !== 0) {
        process.exit(result.exitCode);
      }
      if (result.siteUrl) {
        console.log(`Website ready at ${result.siteUrl}`);
      }
    });

  program
    .command("restore")
    .description("Restore backup into existing instance")
    .argument("<name>", "Instance name")
    .argument("<backup-directory>", "Path to backup files")
    .option("--keep-urls", "Keep original siteurl and home from backup")
    .option("--site-url <url>", "Override site URL (default: https://127.0.0.1:<HTTPS_PORT>)")
    .action(
      async (
        name: string,
        backupDirectory: string,
        options: { keepUrls?: boolean; siteUrl?: string },
      ) => {
        const nameError = validateInstanceName(name);
        if (nameError) {
          console.error(nameError);
          process.exit(1);
        }
        const filesystem = new RealFilesystem();
        const deps = {
          processRunner: new BunProcessRunner({ verbose: program.opts().verbose }),
          filesystem,
          config,
        };
        // Derive default siteUrl from instance .env file
        let siteUrl = options.siteUrl;
        if (!siteUrl && !options.keepUrls) {
          const instanceDir = path.join(config.wodHome, name);
          const envPath = path.join(instanceDir, ".env");
          try {
            const envContent = filesystem.readFile(envPath);
            const portMatch = envContent.match(/^HTTPS_PORT=(\d+)$/m);
            const httpsPort = portMatch ? portMatch[1] : "8443";
            const hostnamesMatch = envContent.match(/^HOSTNAMES=(.+)$/m);
            const firstHostname = hostnamesMatch ? hostnamesMatch[1].split(",")[0] : null;
            siteUrl = firstHostname
              ? `https://${firstHostname}:${httpsPort}`
              : `https://127.0.0.1:${httpsPort}`;
          } catch {
            siteUrl = "https://127.0.0.1:8443";
          }
        }
        const result = await restoreInstance(deps, name, backupDirectory, {
          keepUrls: options.keepUrls,
          siteUrl,
        });
        if (result.error) {
          console.error(result.error);
        }
        for (const warning of result.warnings) {
          console.warn(`Warning: ${warning}`);
        }
        if (result.exitCode !== 0) {
          process.exit(result.exitCode);
        }
      },
    );

  program
    .command("install")
    .description("Extract bundled templates to ~/wod/.template/ for customization")
    .action(() => {
      installBundledTemplates(new RealFilesystem(), config.wodHome);
      console.log(`Templates installed to ${config.wodHome}/.template/`);
    });

  program
    .command("wp")
    .description("Run wp-cli command on a running instance")
    .argument("<name>", "Instance name")
    .argument("[wp-args...]", "wp-cli arguments")
    .allowUnknownOption()
    .action((name: string, wpArgs: string[]) => {
      const nameError = validateInstanceName(name);
      if (nameError) {
        console.error(nameError);
        process.exit(1);
      }
      const deps = {
        processRunner: new BunProcessRunner({ verbose: program.opts().verbose }),
        isTTY: process.stdin.isTTY ?? false,
      };
      const result = buildWpCommand(deps, name, wpArgs);
      if (result.error) {
        console.error(result.error);
        process.exit(result.exitCode);
      }
      if (program.opts().verbose) {
        console.error(`$ ${(result.dockerCommand as string[]).join(" ")}`);
      }
      const proc = Bun.spawnSync(result.dockerCommand as string[], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      process.exit(proc.exitCode);
    });

  configResolver.resolveCommander(program);

  return program;
}
