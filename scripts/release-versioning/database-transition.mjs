#!/usr/bin/env node
import { resolve } from "node:path";
import { resolveDatabaseTransition } from "./database-validation.mjs";

if (process.argv.length !== 5)
{
	console.error("usage: database-transition.mjs <repository-root> <release-version> <from-release-version|fresh>");
	process.exit(64);
}

try
{
	const transition = resolveDatabaseTransition(resolve(process.argv[2]), process.argv[3], process.argv[4]);
	console.log(JSON.stringify(transition));
}
catch (error)
{
	console.error(`database release transition: ${error.message}`);
	process.exit(1);
}
