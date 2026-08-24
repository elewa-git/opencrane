import { posix } from "node:path";

/** Validates and resolves exact, temporary Prisma-boundary exemptions. */
export function resolveExemptions(entries, today)
{
	const active = new Map();
	const errors = [];
	for (const [index, entry] of entries.entries())
	{
		const path = typeof entry?.path === "string" ? posix.normalize(entry.path) : "";
		const operations = Array.isArray(entry?.operations) ? entry.operations : [];
		const expiry = typeof entry?.expiresOn === "string" ? entry.expiresOn : "";
		const valid = path.length > 0
			&& path === entry.path
			&& !path.startsWith("../")
			&& !/[?*\[\]{}]/u.test(path)
			&& path.endsWith(".ts")
			&& typeof entry?.owner === "string"
			&& entry.owner.trim().length > 0
			&& typeof entry?.reason === "string"
			&& entry.reason.trim().length >= 20
			&& operations.length > 0
			&& operations.every(function _IsKnownOperation(operation) { return operation === "delegate" || operation === "transaction"; })
			&& _IsUtcCalendarDate(expiry);
		if (!valid)
		{
			errors.push(`invalid exemption at index ${index}; require an exact .ts path, owner, 20-character reason, known operations, and ISO expiry`);
			continue;
		}
		if (expiry < today)
		{
			errors.push(`expired exemption at index ${index}: ${entry.path} expired ${expiry}`);
			continue;
		}
		if (active.has(path))
		{
			errors.push(`duplicate exemption path at index ${index}: ${path}`);
			continue;
		}
		active.set(path, new Set(operations));
	}
	return { active, errors };
}

/** Returns whether a date is a real calendar day with a stable UTC round trip. */
function _IsUtcCalendarDate(value)
{
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00.000Z`);
	return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

/** Validates the top-level Prisma-boundary policy schema. */
export function validatePolicy(policy)
{
	if (policy?.version !== 1
		|| !Array.isArray(policy?.exemptions)
		|| !Array.isArray(policy?.rawProcedureCalls)
		|| !Array.isArray(policy?.owners?.repositories)
		|| !Array.isArray(policy?.owners?.unitsOfWork)
		|| !Array.isArray(policy?.owners?.compositions))
	{
		throw new Error("invalid Prisma-boundary policy schema");
	}
	const entries = [
		...policy.owners.repositories.map(function _Repository(entry) { return { ...entry, expectedAdapterSuffix: "Repository" }; }),
		...policy.owners.unitsOfWork.map(function _UnitOfWork(entry) { return { ...entry, expectedAdapterSuffix: "UnitOfWork" }; }),
	];
	const keys = new Set();
	for (const entry of entries)
	{
		const valid = _IsExactTypeScriptPath(entry?.path)
			&& typeof entry?.adapter === "string"
			&& /^[A-Za-z_$][\w$]*$/u.test(entry.adapter)
			&& entry.adapter.endsWith(entry.expectedAdapterSuffix)
			&& typeof entry?.contract === "string"
			&& /^[A-Za-z_$][\w$]*$/u.test(entry.contract)
			&& _IsExactImportPath(entry?.contractImportPath)
			&& Array.isArray(entry?.constructs)
			&& entry.constructs.every(_IsExactConstruction);
		const key = `${entry?.path ?? ""}\u0000${entry?.adapter ?? ""}`;
		if (!valid || keys.has(key)) throw new Error("invalid Prisma-boundary owner; require a unique exact path, adapter, contract import, and construction list");
		keys.add(key);
	}
	const constructionKeys = new Set();
	for (const entry of entries)
	{
		for (const construction of entry.constructs)
		{
			const key = `${entry.path}\u0000${entry.adapter}\u0000${construction.adapter}\u0000${construction.importPath}`;
			if (constructionKeys.has(key)) throw new Error("duplicate Prisma-boundary construction declaration");
			constructionKeys.add(key);
		}
	}
	for (const path of policy.owners.compositions)
	{
		if (!_IsExactTypeScriptPath(path))
		{
			throw new Error("invalid Prisma-boundary composition path; require an exact repository-relative .ts path");
		}
	}
	const rawProcedureKeys = new Set();
	for (const procedure of policy.rawProcedureCalls)
	{
		const valid = _IsExactTypeScriptPath(procedure?.path)
			&& procedure.adapter === "PrismaDbProcedureGateway"
			&& procedure.contract === "AbsurdTaskAdmissionProcedure"
			&& procedure.contractImportPath === "./absurd-transaction-spawner.types"
			&& procedure.method === "$queryRaw"
			&& procedure.sqlTemplate === "SELECT task_id, run_id, attempt, created FROM absurd.spawn_task(${this.queueName}, ${taskName}, ${input}::jsonb, ${options}::jsonb)"
			&& typeof procedure.reason === "string"
			&& procedure.reason.trim().length >= 20;
		const key = `${procedure?.path ?? ""}\u0000${procedure?.adapter ?? ""}\u0000${procedure?.method ?? ""}`;
		if (!valid || rawProcedureKeys.has(key))
		{
			throw new Error("invalid raw procedure call; require the exact typed Absurd gateway and fixed SQL template");
		}
		rawProcedureKeys.add(key);
	}
}

/**
 * Supplies the empty raw-procedure list implied by a policy written before that field existed.
 *
 * The current policy remains strict; only a historical Git base may omit the list because that
 * revision could not have approved a raw procedure.
 *
 * Called by: the diff-scoped Prisma boundary checker before it compares old findings.
 * @see scripts/prisma-boundary-check.mjs
 */
export function prepareBasePolicyForComparison(policy)
{
	if (policy?.version === 1 && policy.rawProcedureCalls === undefined)
		return { ...policy, rawProcedureCalls: [] };
	return policy;
}

/** Returns whether an owner path is exact, repository-relative, and TypeScript. */
function _IsExactTypeScriptPath(path)
{
	return typeof path === "string" && path.endsWith(".ts") && !path.startsWith("../") && !/[?*\[\]{}]/u.test(path);
}

/** Returns whether an import path is an exact module specifier. */
function _IsExactImportPath(path)
{
	return typeof path === "string" && path.length > 0 && !/[?*\[\]{}]/u.test(path);
}

/** Returns whether one transaction-scoped repository construction is exact. */
function _IsExactConstruction(construction)
{
	return typeof construction?.adapter === "string"
		&& /^[A-Za-z_$][\w$]*Repository$/u.test(construction.adapter)
		&& _IsExactImportPath(construction?.importPath);
}
