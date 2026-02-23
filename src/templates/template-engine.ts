import * as path from "node:path";
import Handlebars from "handlebars";
import type { Filesystem } from "../utils/filesystem.ts";
import type { BundledTemplate } from "./bundled-templates.ts";
import type { TemplateVars } from "./template-vars.ts";

export interface TemplateFile {
  relativePath: string;
  content: string;
}

export interface TemplateSource {
  getTemplateFiles(templateName: string): TemplateFile[];
}

export class BundledTemplateSource implements TemplateSource {
  constructor(private templates: BundledTemplate[]) {}

  getTemplateFiles(templateName: string): TemplateFile[] {
    const template = this.templates.find((t) => t.name === templateName);
    if (!template) {
      throw new Error(`Bundled template not found: ${templateName}`);
    }
    return template.files;
  }
}

export class DirectoryTemplateSource implements TemplateSource {
  constructor(
    private templateDir: string,
    private filesystem: Filesystem,
  ) {}

  getTemplateFiles(_templateName: string): TemplateFile[] {
    const files = this.filesystem.listFilesRecursive(this.templateDir);
    return files.map((relativePath) => ({
      relativePath,
      content: this.filesystem.readFile(path.join(this.templateDir, relativePath)),
    }));
  }
}

export function installTemplate(
  templateName: string,
  targetDir: string,
  vars: TemplateVars,
  filesystem: Filesystem,
  templateSource: TemplateSource,
): void {
  const files = templateSource.getTemplateFiles(templateName);
  for (const file of files) {
    let outputPath: string;
    let outputContent: string;

    if (file.relativePath.endsWith(".hbs")) {
      const compiled = Handlebars.compile(file.content, { noEscape: true });
      outputContent = compiled(vars);
      outputPath = path.join(targetDir, file.relativePath.replace(/\.hbs$/, ""));
    } else {
      outputContent = file.content;
      outputPath = path.join(targetDir, file.relativePath);
    }

    filesystem.ensureDirectory(path.dirname(outputPath));
    filesystem.writeFile(outputPath, outputContent);
  }
}
