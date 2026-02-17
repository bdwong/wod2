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
});
