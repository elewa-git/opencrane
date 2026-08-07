/**
 * Emit the OpenAPI 3.1 spec to the workspace dist folder.
 *
 * Run via: npm run emit-openapi -w @opencrane/server
 *
 * Contract drift gate:
 *   npm run emit-openapi -w @opencrane/server
 *   nx run contracts:generate
 *   git diff --exit-code libs/contracts/src/generated/api.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// tsx resolves .js → .ts, so this import works both in tsx (dev) and
// after tsc (when importing from dist/).
import { spec } from "@opencrane/backend/server/api-spec";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(__dirname, "../../../dist/apps/opencrane/openapi.json");

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(spec, null, 2) + "\n", "utf8");
console.log(`OpenAPI spec written to ${outputPath}`);
