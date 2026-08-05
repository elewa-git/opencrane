#!/usr/bin/env node

import { runCli } from "./pr-stack-integrity/cli.mjs";

process.exitCode = runCli(process.argv.slice(2));
