import { delegateMatches, transactionMatches } from "./prisma-bindings.mjs";
import { classes, enclosingClass, importedBindings, ownerIdentity, ownsContract } from "./typescript-ownership.mjs";

/** Returns whether a path is hand-maintained production TypeScript. */
export function isProductionTypeScript(path)
{
	return path.endsWith(".ts")
		&& !path.endsWith(".d.ts")
		&& !path.includes("/__tests__/")
		&& !path.endsWith(".test.ts")
		&& !path.endsWith(".spec.ts")
		&& !path.includes("/generated/")
		&& !path.includes("/fixtures/")
		&& !path.includes("/node_modules/")
		&& !path.includes("/dist/");
}

/** Finds direct Prisma operations that escape repository or unit-of-work owners. */
export function inspectPrismaBoundary(path, source, modelDelegates, owners, exemption = new Set())
{
	if (!isProductionTypeScript(path)) return [];
	const classOwners = classes(source);
	const imports = importedBindings(source);
	const findings = [];
	const prismaImport = /^import[^;]+from\s+"@prisma\/client";/gmu.exec(source);
	const authorizedOwner = classOwners.some(function _Authorized(candidate)
	{
		return ownsContract(candidate, imports, owners.repositories) || ownsContract(candidate, imports, owners.unitsOfWork);
	});
	if (prismaImport !== null && !authorizedOwner && !owners.compositions.includes(path))
	{
		findings.push(_Finding(path, source, prismaImport.index, "PRISMA-IMPORT-OWNER", "@prisma/client import outside an authoritative Repository, UnitOfWork, or exact composition owner", "module"));
	}
	for (const match of transactionMatches(source, imports))
	{
		if (exemption.has("transaction")) continue;
		const owner = enclosingClass(classOwners, match.index ?? 0);
		if (!ownsContract(owner, imports, owners.unitsOfWork))
		{
			findings.push(_Finding(path, source, match.index ?? 0, "PRISMA-TRANSACTION-OWNER", "direct $transaction call outside a class implementing an imported UnitOfWork contract", ownerIdentity(source, classOwners, match.index ?? 0)));
		}
	}
	for (const match of delegateMatches(source, modelDelegates, imports))
	{
		if (exemption.has("delegate")) continue;
		const owner = enclosingClass(classOwners, match.index ?? 0);
		if (!ownsContract(owner, imports, owners.repositories))
		{
			findings.push(_Finding(path, source, match.index ?? 0, "PRISMA-DELEGATE-OWNER", `direct ${match.delegate}.${match.method} call outside a class implementing an authoritative Repository contract`, ownerIdentity(source, classOwners, match.index ?? 0)));
		}
	}
	return findings;
}

/** Extracts lower-camel Prisma delegate names from schema model declarations. */
export function prismaModelDelegates(schemaSources)
{
	const delegates = new Set();
	for (const source of schemaSources)
	{
		for (const match of source.matchAll(/^model\s+([A-Za-z][A-Za-z0-9_]*)\s*\{/gmu))
		{
			delegates.add(match[1][0].toLowerCase() + match[1].slice(1));
		}
	}
	return [...delegates].sort();
}

/** Returns only ownership bypasses newly introduced relative to a base version. */
export function findingDelta(baseFindings, currentFindings)
{
	const remaining = new Map();
	for (const finding of baseFindings)
	{
		const key = `${finding.rule}\u0000${finding.message}\u0000${finding.owner}`;
		remaining.set(key, (remaining.get(key) ?? 0) + 1);
	}
	return currentFindings.filter(function _IsNew(finding)
	{
		const key = `${finding.rule}\u0000${finding.message}\u0000${finding.owner}`;
		const count = remaining.get(key) ?? 0;
		if (count === 0) return true;
		remaining.set(key, count - 1);
		return false;
	});
}

/** Builds a stable checker finding. */
function _Finding(path, source, offset, rule, message, owner)
{
	return { path, line: source.slice(0, offset).split("\n").length, rule, message, owner };
}
