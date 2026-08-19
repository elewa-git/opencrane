#!/usr/bin/env node
import { resolve } from "node:path";
import { resolveSchemaLineage } from "./database-validation.mjs";

if (process.argv.length !== 4)
{
	console.error("usage: schema-lineage.mjs <repository-root> <release-version>");
	process.exit(64);
}

try
{
	const lineage = resolveSchemaLineage(resolve(process.argv[2]), process.argv[3]);
	console.log(JSON.stringify(lineage));
}
catch (error)
{
	console.error(`database schema lineage: ${error.message}`);
	process.exit(1);
}
