import { describe, expect, test } from "bun:test";
import { MockFilesystem } from "../utils/mock-filesystem.ts";
import { installBundledTemplates } from "./install.ts";

describe("installBundledTemplates", () => {
  test("writes all bundled template files to .template directory", () => {
    const fs = new MockFilesystem();
    installBundledTemplates(fs, "/home/user/wod");
    // php8.2 template should be installed
    const compose = fs.writtenFiles.get("/home/user/wod/.template/php8.2/docker-compose.yml.hbs");
    expect(compose).toBeDefined();
    expect(compose).toContain("{{mysqlVersion}}");
  });

  test("creates template directory structure", () => {
    const fs = new MockFilesystem();
    installBundledTemplates(fs, "/home/user/wod");
    expect(fs.ensuredDirs).toContain("/home/user/wod/.template/php8.2");
  });

  test("writes Dockerfile template", () => {
    const fs = new MockFilesystem();
    installBundledTemplates(fs, "/home/user/wod");
    const dockerfile = fs.writtenFiles.get(
      "/home/user/wod/.template/php8.2/wp-php-custom/Dockerfile.hbs",
    );
    expect(dockerfile).toBeDefined();
    expect(dockerfile).toContain("{{wordpressTag}}");
  });

  test("writes default.ini as-is", () => {
    const fs = new MockFilesystem();
    installBundledTemplates(fs, "/home/user/wod");
    const ini = fs.writtenFiles.get("/home/user/wod/.template/php8.2/wp-php-custom/default.ini");
    expect(ini).toBeDefined();
    expect(ini).toContain("upload_max_filesize=100M");
  });
});
