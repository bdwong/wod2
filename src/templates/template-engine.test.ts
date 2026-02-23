import { describe, expect, test } from "bun:test";
import { MockFilesystem } from "../utils/mock-filesystem.ts";
import type { BundledTemplate } from "./bundled-templates.ts";
import {
  BundledTemplateSource,
  DirectoryTemplateSource,
  installTemplate,
} from "./template-engine.ts";
import type { TemplateVars } from "./template-vars.ts";

const defaultVars: TemplateVars = {
  wordpressVersion: "6.7.1",
  phpVersion: "8.2",
  mysqlVersion: "5.7",
  wordpressTag: "6.7.1-php8.2-apache",
  wordpressCustomImageTag: "6.7.1-php8.2-custom",
};

describe("BundledTemplateSource", () => {
  const templates: BundledTemplate[] = [
    {
      name: "php8.2",
      files: [
        { relativePath: "docker-compose.yml.hbs", content: "image: mysql:{{mysqlVersion}}" },
        { relativePath: "wp-php-custom/default.ini", content: "upload=100M" },
      ],
    },
  ];

  test("returns files for matching template", () => {
    const source = new BundledTemplateSource(templates);
    const files = source.getTemplateFiles("php8.2");
    expect(files).toHaveLength(2);
    expect(files[0].relativePath).toBe("docker-compose.yml.hbs");
  });

  test("throws for unknown template", () => {
    const source = new BundledTemplateSource(templates);
    expect(() => source.getTemplateFiles("php7.4")).toThrow("Bundled template not found");
  });
});

describe("DirectoryTemplateSource", () => {
  test("reads files from directory using filesystem", () => {
    const fs = new MockFilesystem();
    fs.setRecursiveFiles("/templates/php8.2", [
      "docker-compose.yml.hbs",
      "wp-php-custom/Dockerfile.hbs",
    ]);
    fs.addFile("/templates/php8.2/docker-compose.yml.hbs", "compose content");
    fs.addFile("/templates/php8.2/wp-php-custom/Dockerfile.hbs", "dockerfile content");
    const source = new DirectoryTemplateSource("/templates/php8.2", fs);
    const files = source.getTemplateFiles("php8.2");
    expect(files).toHaveLength(2);
    expect(files[0].content).toBe("compose content");
  });
});

describe("installTemplate", () => {
  test("compiles .hbs files with Handlebars and strips extension", () => {
    const fs = new MockFilesystem();
    const templates: BundledTemplate[] = [
      {
        name: "php8.2",
        files: [
          { relativePath: "docker-compose.yml.hbs", content: "image: mysql:{{mysqlVersion}}" },
        ],
      },
    ];
    const source = new BundledTemplateSource(templates);
    installTemplate("php8.2", "/target", defaultVars, fs, source);
    const content = fs.writtenFiles.get("/target/docker-compose.yml");
    expect(content).toBe("image: mysql:5.7");
  });

  test("copies non-.hbs files as-is", () => {
    const fs = new MockFilesystem();
    const templates: BundledTemplate[] = [
      {
        name: "php8.2",
        files: [{ relativePath: "wp-php-custom/default.ini", content: "upload=100M\n" }],
      },
    ];
    const source = new BundledTemplateSource(templates);
    installTemplate("php8.2", "/target", defaultVars, fs, source);
    const content = fs.writtenFiles.get("/target/wp-php-custom/default.ini");
    expect(content).toBe("upload=100M\n");
  });

  test("creates parent directories for output files", () => {
    const fs = new MockFilesystem();
    const templates: BundledTemplate[] = [
      {
        name: "php8.2",
        files: [
          {
            relativePath: "wp-php-custom/Dockerfile.hbs",
            content: "FROM wordpress:{{wordpressTag}}",
          },
        ],
      },
    ];
    const source = new BundledTemplateSource(templates);
    installTemplate("php8.2", "/target", defaultVars, fs, source);
    expect(fs.ensuredDirs).toContain("/target/wp-php-custom");
  });

  test("substitutes all template variables correctly", () => {
    const fs = new MockFilesystem();
    const templates: BundledTemplate[] = [
      {
        name: "php8.2",
        files: [
          {
            relativePath: "docker-compose.yml.hbs",
            content: "mysql:{{mysqlVersion}}\nwordpress:{{wordpressCustomImageTag}}",
          },
          {
            relativePath: "wp-php-custom/Dockerfile.hbs",
            content: "FROM wordpress:{{wordpressTag}}",
          },
        ],
      },
    ];
    const source = new BundledTemplateSource(templates);
    installTemplate("php8.2", "/out", defaultVars, fs, source);
    expect(fs.writtenFiles.get("/out/docker-compose.yml")).toBe(
      "mysql:5.7\nwordpress:6.7.1-php8.2-custom",
    );
    expect(fs.writtenFiles.get("/out/wp-php-custom/Dockerfile")).toBe(
      "FROM wordpress:6.7.1-php8.2-apache",
    );
  });

  test("uses custom versions", () => {
    const fs = new MockFilesystem();
    const customVars: TemplateVars = {
      wordpressVersion: "5.9",
      phpVersion: "7.4",
      mysqlVersion: "8.0",
      wordpressTag: "5.9-php7.4-apache",
      wordpressCustomImageTag: "5.9-php7.4-custom",
    };
    const templates: BundledTemplate[] = [
      {
        name: "php8.2",
        files: [
          { relativePath: "docker-compose.yml.hbs", content: "image: mysql:{{mysqlVersion}}" },
        ],
      },
    ];
    const source = new BundledTemplateSource(templates);
    installTemplate("php8.2", "/out", customVars, fs, source);
    expect(fs.writtenFiles.get("/out/docker-compose.yml")).toBe("image: mysql:8.0");
  });
});
