import { Command } from "commander";
import { createInstance } from "../commands/create.ts";
import { downInstance } from "../commands/down.ts";
import { listInstances } from "../commands/ls.ts";
import { formatLsOutput } from "../commands/ls-formatter.ts";
import { restoreInstance } from "../commands/restore.ts";
import { rmInstance } from "../commands/rm.ts";
import { upInstance } from "../commands/up.ts";
import { buildWpCommand } from "../commands/wp.ts";
import { resolveConfig } from "../config/config.ts";
import { resolveCreateConfig } from "../config/create-config.ts";
import { BunProcessRunner } from "../docker/process-runner.ts";
import { RealFilesystem } from "../utils/filesystem.ts";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("wod")
    .description("WordPress on Docker — manage disposable WordPress instances")
    .version("0.1.0");

  program
    .command("create")
    .description("Create a new WordPress Docker instance")
    .argument("<name>", "Instance name")
    .argument("[backup-directory]", "Path to backup files to restore")
    .action(async (name: string, backupDirectory?: string) => {
      const config = resolveConfig();
      const createConfig = resolveCreateConfig();
      const deps = {
        processRunner: new BunProcessRunner(),
        filesystem: new RealFilesystem(),
        config,
        createConfig,
        sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      };
      const result = await createInstance(deps, name, backupDirectory);
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
    });

  program
    .command("ls")
    .description("List all instances with status")
    .action(() => {
      const config = resolveConfig();
      const result = listInstances({
        processRunner: new BunProcessRunner(),
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
    .action((name: string) => {
      const config = resolveConfig();
      const deps = {
        processRunner: new BunProcessRunner(),
        filesystem: new RealFilesystem(),
        config,
      };
      const result = upInstance(deps, name);
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
      const config = resolveConfig();
      const deps = {
        processRunner: new BunProcessRunner(),
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
      const config = resolveConfig();
      const deps = {
        processRunner: new BunProcessRunner(),
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
    .command("restore")
    .description("Restore backup into existing instance")
    .argument("<name>", "Instance name")
    .argument("<backup-directory>", "Path to backup files")
    .action((name: string, backupDirectory: string) => {
      const config = resolveConfig();
      const deps = {
        processRunner: new BunProcessRunner(),
        filesystem: new RealFilesystem(),
        config,
      };
      const result = restoreInstance(deps, name, backupDirectory);
      if (result.error) {
        console.error(result.error);
      }
      for (const warning of result.warnings) {
        console.warn(`Warning: ${warning}`);
      }
      if (result.exitCode !== 0) {
        process.exit(result.exitCode);
      }
    });

  program
    .command("wp")
    .description("Run wp-cli command on a running instance")
    .argument("<name>", "Instance name")
    .argument("[wp-args...]", "wp-cli arguments")
    .allowUnknownOption()
    .action((name: string, wpArgs: string[]) => {
      const deps = {
        processRunner: new BunProcessRunner(),
        isTTY: process.stdin.isTTY ?? false,
      };
      const result = buildWpCommand(deps, name, wpArgs);
      if (result.error) {
        console.error(result.error);
        process.exit(result.exitCode);
      }
      const proc = Bun.spawnSync(result.dockerCommand as string[], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      process.exit(proc.exitCode);
    });

  return program;
}
