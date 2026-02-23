import * as path from "node:path";
import { BUNDLED_TEMPLATES } from "../templates/bundled-templates.ts";
import type { Filesystem } from "../utils/filesystem.ts";

export function installBundledTemplates(filesystem: Filesystem, wodHome: string): void {
  for (const template of BUNDLED_TEMPLATES) {
    const templateDir = path.join(wodHome, ".template", template.name);
    filesystem.ensureDirectory(templateDir);
    for (const file of template.files) {
      const filePath = path.join(templateDir, file.relativePath);
      filesystem.ensureDirectory(path.dirname(filePath));
      filesystem.writeFile(filePath, file.content);
    }
  }
}
