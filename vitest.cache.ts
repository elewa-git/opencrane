import path from "node:path";
import { fileURLToPath } from "node:url";

const _ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * Root-anchored Vite/Vitest cache directory for a package's vitest config.
 *
 * Vite's dep-optimizer defaults `cacheDir` to `<package>/node_modules/.vite`, which spawns a
 * stray `node_modules` directory inside every package that runs tests. Anchoring the cache under
 * the single root `node_modules` keeps package trees free of build/test artifacts; the per-package
 * subdirectory keeps parallel Nx test runs from sharing one optimizer cache.
 *
 * @param configUrl - The calling config's `import.meta.url`.
 * @returns An absolute cache directory unique to the calling package.
 */
export function _PackageCacheDir(configUrl: string): string
{
  const pkg = path.relative(_ROOT, path.dirname(fileURLToPath(configUrl)));
  const slug = pkg === "" ? "root" : pkg.split(path.sep).join("__");
  return path.join(_ROOT, "node_modules", ".vite", slug);
}
