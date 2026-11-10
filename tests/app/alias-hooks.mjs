// Lets Node's test runner load app TypeScript: maps "@/x" to src/x and adds
// the .ts/.tsx extension that Metro adds for the app. Tests only.
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function withExtension(file) {
  if (existsSync(file) && statSync(file).isFile()) return file;
  for (const ext of EXTENSIONS) if (existsSync(file + ext)) return file + ext;
  return null;
}

export async function resolve(specifier, context, next) {
  let target = null;
  if (specifier.startsWith("@/")) target = withExtension(path.join(root, "src", specifier.slice(2)));
  else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && context.parentURL.includes("/src/")) {
    target = withExtension(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
  }
  return target ? next(pathToFileURL(target).href, context) : next(specifier, context);
}
