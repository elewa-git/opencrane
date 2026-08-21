#!/usr/bin/env node
import { resolve } from "node:path";
import { resolveDatabaseTransition } from "./database-validation.mjs";

// This entry point admits the reviewed 0.9.2 to 0.9.3 exception without weakening the generic
// resolver, which continues to reject schema migrations in a patch release.
const releaseVersion = process.argv[3];
const fromReleaseVersion = process.argv[4];
if (process.argv.length !== 5 || releaseVersion !== "0.9.3" || fromReleaseVersion !== "0.9.2")
{
	console.error("usage: database-transition-0.9.3.mjs <repository-root> 0.9.3 0.9.2");
	process.exit(64);
}

try
{
	const transition = resolveDatabaseTransition(resolve(process.argv[2]), releaseVersion, fromReleaseVersion, {
		manualTransitionId: "0.9.2-to-0.9.3",
	});
	console.log(JSON.stringify(transition));
}
catch (error)
{
	console.error(`database 0.9.3 manual release transition: ${error.message}`);
	process.exit(1);
}
