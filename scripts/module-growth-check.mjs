#!/usr/bin/env node

/**
 * Executable entrypoint for the language-neutral production module-growth gate.
 *
 * Policy evaluation and Git discovery live in focused modules under ``scripts/module-growth`` so
 * this file remains a declarative composition root.
 */

import { runModuleGrowthCheck } from "./module-growth/cli.mjs";

runModuleGrowthCheck(process.argv.slice(2));
