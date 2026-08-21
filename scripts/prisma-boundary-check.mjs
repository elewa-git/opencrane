#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { findingDelta, inspectPrismaBoundary, isProductionTypeScript, prismaModelDelegates, resolveExemptions, validateOwnerDeclarations, validatePolicy, validateRawProcedureDeclarations } from "./prisma-boundary/core.mjs";

/** Repository root for all path and Git operations. */
const _ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
/** Checked-in exception policy for otherwise unexpressible legacy boundaries. */
const _POLICY_PATH = join(_ROOT, "docs/agents/prisma-boundary-policy.json");

/** Executes the diff-scoped Prisma repository/unit-of-work architecture check. */
function _Main()
{
	const policy = JSON.parse(readFileSync(_POLICY_PATH, "utf8"));
	validatePolicy(policy);
	const today = new Date().toISOString().slice(0, 10);
	const exemptions = resolveExemptions(policy.exemptions, today);
	if (exemptions.errors.length > 0)
	{
		for (const error of exemptions.errors) console.error(`docs/agents/prisma-boundary-policy.json:1\tERROR\tPRISMA-BOUNDARY-EXEMPTION\t${error}`);
		process.exitCode = 1;
		return;
	}

	const schemaDirectory = join(_ROOT, "apps/opencrane/prisma/schema");
	const schemaSources = readdirSync(schemaDirectory)
		.filter(function _IsSchema(path) { return path.endsWith(".prisma"); })
		.map(function _ReadSchema(path) { return readFileSync(join(schemaDirectory, path), "utf8"); });
	const delegates = prismaModelDelegates(schemaSources);
	const scope = _Scope(process.argv.slice(2));
	const files = _Unique([...scope.files, ...policy.rawProcedureCalls.map(function _Path(procedure) { return procedure.path; })]);
	let findings = 0;
	const ownerPaths = [...new Set([...policy.owners.repositories, ...policy.owners.unitsOfWork].map(function _Path(entry) { return entry.path; }))];
	for (const path of ownerPaths)
	{
		const absolutePath = join(_ROOT, path);
		if (!existsSync(absolutePath))
		{
			console.error(`${path}:1\tERROR\tPRISMA-POLICY-OWNER\tpolicy owner path does not exist`);
			findings += 1;
			continue;
		}
		const source = readFileSync(absolutePath, "utf8");
		for (const finding of validateOwnerDeclarations(path, source, policy.owners))
		{
			console.error(`${finding.path}:${finding.line}\tERROR\t${finding.rule}\t${finding.message}`);
			findings += 1;
		}
	}
	for (const path of policy.owners.compositions)
	{
		const absolutePath = join(_ROOT, path);
		if (!existsSync(absolutePath) || !readFileSync(absolutePath, "utf8").includes('from "@prisma/client"'))
		{
			console.error(`${path}:1\tERROR\tPRISMA-POLICY-COMPOSITION\tcomposition path must exist and import @prisma/client`);
			findings += 1;
		}
	}
	for (const procedure of policy.rawProcedureCalls)
	{
		const absolutePath = join(_ROOT, procedure.path);
		if (!existsSync(absolutePath))
		{
			console.error(`${procedure.path}:1\tERROR\tPRISMA-POLICY-RAW-PROCEDURE\traw procedure gateway path does not exist`);
			findings += 1;
			continue;
		}
		const source = readFileSync(absolutePath, "utf8");
		for (const finding of validateRawProcedureDeclarations(procedure.path, source, policy.rawProcedureCalls))
		{
			console.error(`${finding.path}:${finding.line}\tERROR\t${finding.rule}\t${finding.message}`);
			findings += 1;
		}
	}
	for (const path of files)
	{
		if (!isProductionTypeScript(path) || !existsSync(join(_ROOT, path))) continue;
		const source = readFileSync(join(_ROOT, path), "utf8");
		const current = inspectPrismaBoundary(path, source, delegates, policy.owners, exemptions.active.get(path), policy.rawProcedureCalls);
		const baseSource = scope.base === undefined ? undefined : _BaseSource(scope.base, path);
		const base = baseSource === undefined ? [] : inspectPrismaBoundary(path, baseSource, delegates, policy.owners, exemptions.active.get(path), policy.rawProcedureCalls);
		for (const finding of scope.base === undefined ? current : findingDelta(base, current))
		{
			console.error(`${finding.path}:${finding.line}\tERROR\t${finding.rule}\t${finding.message}`);
			findings += 1;
		}
	}
	console.log(`prisma-boundary-check: ${files.filter(isProductionTypeScript).length} production TypeScript file(s) checked — ${findings} error(s).`);
	if (findings > 0) process.exitCode = 1;
}

/** Resolves explicit, branch-diff, working-tree, or full-scan file scope. */
function _Scope(arguments_)
{
	if (arguments_[0] === "--all")
	{
		return { files: _GitNull(["ls-files", "-z", "--", "*.ts"]) };
	}
	if (arguments_[0] === "--diff")
	{
		if (!arguments_[1]) throw new Error("--diff requires a base ref");
		return {
			files: _Unique([
				..._GitNull(["diff", "--name-only", "--diff-filter=ACMR", "-z", arguments_[1], "--", "*.ts"]),
				..._GitNull(["ls-files", "--others", "--exclude-standard", "-z", "--", "*.ts"]),
			]),
			base: arguments_[1],
		};
	}
	if (arguments_.length > 0) return { files: _Unique(arguments_) };
	const tracked = _GitNull(["diff", "--name-only", "--diff-filter=ACMR", "-z", "HEAD", "--", "*.ts"]);
	const untracked = _GitNull(["ls-files", "--others", "--exclude-standard", "-z", "--", "*.ts"]);
	return { files: _Unique([...tracked, ...untracked]), base: "HEAD" };
}

/** Reads a file from the base tree, returning undefined when it is newly added. */
function _BaseSource(base, path)
{
	try
	{
		return execFileSync("git", ["show", `${base}:${path}`], { cwd: _ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
	}
	catch
	{
		return undefined;
	}
}

/** Runs a NUL-delimited Git path query without corrupting whitespace in filenames. */
function _GitNull(arguments_)
{
	const output = execFileSync("git", arguments_, { cwd: _ROOT, encoding: "utf8" });
	return output.split("\0").filter(Boolean);
}

/** Removes duplicate paths without changing Git order. */
function _Unique(paths)
{
	return [...new Set(paths)];
}

_Main();
