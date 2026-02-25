import { describe, expect, test } from "bun:test";
import { MockFilesystem } from "../utils/mock-filesystem.ts";
import { BundledTemplateSource, DirectoryTemplateSource } from "./template-engine.ts";
import { resolveTemplateSource } from "./template-resolver.ts";

describe("resolveTemplateSource", () => {
  test("returns DirectoryTemplateSource when user template dir exists", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/.template/php8.2");
    const source = resolveTemplateSource("php8.2", fs, "/home/user/wod");
    expect(source).toBeInstanceOf(DirectoryTemplateSource);
  });

  test("returns BundledTemplateSource when no user template dir exists", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod");
    const source = resolveTemplateSource("php8.2", fs, "/home/user/wod");
    expect(source).toBeInstanceOf(BundledTemplateSource);
  });

  test.each([
    "default",
    "no-mcrypt",
    "php7.4",
    "php8.1",
    "php8.2",
    "custom",
  ])("resolves bundled template '%s'", (name) => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod");
    const source = resolveTemplateSource(name, fs, "/home/user/wod");
    expect(source).toBeInstanceOf(BundledTemplateSource);
  });

  test("throws when template not found anywhere", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod");
    expect(() => resolveTemplateSource("nonexistent", fs, "/home/user/wod")).toThrow(
      "Template not found: nonexistent",
    );
  });

  test("prefers user template dir over bundled", () => {
    const fs = new MockFilesystem();
    fs.addDirectory("/home/user/wod/.template/php8.2");
    const source = resolveTemplateSource("php8.2", fs, "/home/user/wod");
    expect(source).toBeInstanceOf(DirectoryTemplateSource);
  });
});
