/**
 * Patch jsonc-parser to use ESM entry point instead of UMD.
 *
 * The UMD build uses dynamic require("./impl/format") calls that Bun's
 * bundler cannot statically resolve, breaking --compile builds.
 * The ESM build uses static imports that bundle correctly.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const pkgPath = resolve(import.meta.dirname, "../node_modules/jsonc-parser/package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

if (pkg.main !== "./lib/esm/main.js") {
	pkg.main = "./lib/esm/main.js";
	writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
	console.log("Patched jsonc-parser main → ESM");
} else {
	console.log("jsonc-parser already patched");
}
