import { describe, expect, test } from "bun:test";
import { createProgram } from "./cli.ts";

describe("createProgram", () => {
  test("returns a Commander program", () => {
    const program = createProgram();
    expect(program.name()).toBe("wod");
  });

  test("has an ls subcommand", () => {
    const program = createProgram();
    const lsCommand = program.commands.find((cmd) => cmd.name() === "ls");
    expect(lsCommand).toBeDefined();
  });

  test("ls subcommand has a description", () => {
    const program = createProgram();
    const lsCommand = program.commands.find((cmd) => cmd.name() === "ls");
    expect(lsCommand?.description()).toBeTruthy();
  });

  test("has a create subcommand", () => {
    const program = createProgram();
    const createCommand = program.commands.find((cmd) => cmd.name() === "create");
    expect(createCommand).toBeDefined();
    expect(createCommand?.description()).toBeTruthy();
  });

  test("create subcommand has --php-version option", () => {
    const program = createProgram();
    const createCommand = program.commands.find((cmd) => cmd.name() === "create");
    const option = createCommand?.options.find((opt) => opt.long === "--php-version");
    expect(option).toBeDefined();
  });

  test("create subcommand has --wordpress-version option", () => {
    const program = createProgram();
    const createCommand = program.commands.find((cmd) => cmd.name() === "create");
    const option = createCommand?.options.find((opt) => opt.long === "--wordpress-version");
    expect(option).toBeDefined();
  });

  test("create subcommand has --template option", () => {
    const program = createProgram();
    const createCommand = program.commands.find((cmd) => cmd.name() === "create");
    const option = createCommand?.options.find((opt) => opt.long === "--template");
    expect(option).toBeDefined();
  });
});
