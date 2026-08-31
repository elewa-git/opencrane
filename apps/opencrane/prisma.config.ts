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
 * Pre-1.0 there is no migration ledger: the reviewed target baseline creates every database, and a
 * schema change edits that baseline (see docs/agents/versioning.md).
 */
export default defineConfig({
  schema: path.join(_packageRoot, "prisma", "schema"),
});
