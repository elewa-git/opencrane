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
 * Prisma Migrate is the only upgrade ledger from 0.10.0 onward. The separate target baseline still
 * creates new databases, while the dedicated migration Job runs this migration directory for an
 * existing database.
 */
export default defineConfig({
  schema: path.join(_packageRoot, "prisma", "schema"),
  migrations: { path: path.join(_packageRoot, "prisma", "prisma-migrations") },
});
