import * as path from "node:path";
import type { Filesystem } from "../utils/filesystem.ts";
import { BUNDLED_TEMPLATES } from "./bundled-templates.ts";
import type { TemplateSource } from "./template-engine.ts";
import { BundledTemplateSource, DirectoryTemplateSource } from "./template-engine.ts";

export function resolveTemplateSource(
  templateName: string,
  filesystem: Filesystem,
  wodHome: string,
): TemplateSource {
  const userTemplateDir = path.join(wodHome, ".template", templateName);
  if (filesystem.isDirectory(userTemplateDir)) {
    return new DirectoryTemplateSource(userTemplateDir, filesystem);
  }

  const bundled = BUNDLED_TEMPLATES.find((t) => t.name === templateName);
  if (bundled) {
    return new BundledTemplateSource(BUNDLED_TEMPLATES);
  }

  throw new Error(`Template not found: ${templateName}`);
}
