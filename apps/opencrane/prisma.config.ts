import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "prisma/config";

// Directory of THIS config file (the @opencrane/server package root). Resolving the schema
// against it keeps generation correct no matter which directory Prisma is invoked from.
const _packageRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Prisma config for the control-plane database.
 *
 * The schema is a multi-file folder (`prisma/schema/`), with the `datasource` block living in
 * `prisma/schema/base.prisma`. Database creation consumes the separate app-owned target baseline;
 * Prisma remains a build-time schema and client generator, not a runtime migration authority.
 */
export default defineConfig({
  schema: path.join(_packageRoot, "prisma", "schema"),
});
