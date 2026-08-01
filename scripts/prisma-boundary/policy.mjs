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
			&& /^\d{4}-\d{2}-\d{2}$/u.test(expiry);
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

/** Validates the top-level Prisma-boundary policy schema. */
export function validatePolicy(policy)
{
	if (policy?.version !== 1
		|| !Array.isArray(policy?.exemptions)
		|| !Array.isArray(policy?.owners?.repositories)
		|| !Array.isArray(policy?.owners?.unitsOfWork)
		|| !Array.isArray(policy?.owners?.compositions))
	{
		throw new Error("invalid Prisma-boundary policy schema");
	}
	const entries = [...policy.owners.repositories, ...policy.owners.unitsOfWork];
	const keys = new Set();
	for (const entry of entries)
	{
		const valid = typeof entry?.contract === "string"
			&& /^[A-Za-z_$][\w$]*$/u.test(entry.contract)
			&& typeof entry?.importPath === "string"
			&& entry.importPath.length > 0
			&& !/[?*\[\]{}]/u.test(entry.importPath);
		const key = `${entry?.contract ?? ""}\u0000${entry?.importPath ?? ""}`;
		if (!valid || keys.has(key)) throw new Error("invalid Prisma-boundary owner contract; require a unique exact contract name and import path");
		keys.add(key);
	}
	for (const path of policy.owners.compositions)
	{
		if (typeof path !== "string" || !path.endsWith(".ts") || path.startsWith("../") || /[?*\[\]{}]/u.test(path))
		{
			throw new Error("invalid Prisma-boundary composition path; require an exact repository-relative .ts path");
		}
	}
}
