import { createHash } from "node:crypto";

import { delegateMatches, rawPrismaMethodMatches, transactionMatches } from "./prisma-bindings.mjs";
import { rawProcedureSourcePin } from "./policy.mjs";
import { inspectRawProcedureCall } from "./raw-procedure-inspection.mjs";
import { authorizedOwner, classes, enclosingClass, importedBindings, isTransactionScopedConstruction, ownerIdentity, repositoryAcceptsTransactionClient, repositoryConstructions } from "./typescript-ownership.mjs";

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
export function inspectPrismaBoundary(path, source, modelDelegates, owners, exemption = new Set(), rawProcedureCalls = [])
{
	if (!isProductionTypeScript(path)) return [];
	const classOwners = classes(source);
	const imports = importedBindings(source);
	const findings = [];
	const prismaImport = /^import[^;]+from\s+"@prisma\/client";/gmu.exec(source);
	const hasAuthorizedOwner = classOwners.some(function _Authorized(candidate)
	{
		return authorizedOwner(candidate, imports, owners.repositories, path) !== undefined || authorizedOwner(candidate, imports, owners.unitsOfWork, path) !== undefined;
	});
	const hasRawProcedureOwner = classOwners.some(function _RawProcedure(candidate)
	{
		return authorizedOwner(candidate, imports, rawProcedureCalls, path) !== undefined;
	});
	if (prismaImport !== null && !hasAuthorizedOwner && !hasRawProcedureOwner && !owners.compositions.includes(path))
	{
		findings.push(_Finding(path, source, prismaImport.index, "PRISMA-IMPORT-OWNER", "@prisma/client import outside an authoritative Repository, UnitOfWork, or exact composition owner", "module"));
	}
	for (const match of transactionMatches(source, imports))
	{
		if (exemption.has("transaction")) continue;
		const owner = enclosingClass(classOwners, match.index ?? 0);
		if (authorizedOwner(owner, imports, owners.unitsOfWork, path) === undefined)
		{
			findings.push(_Finding(path, source, match.index ?? 0, "PRISMA-TRANSACTION-OWNER", "direct $transaction call outside an exact policy-authorized UnitOfWork adapter", ownerIdentity(source, classOwners, match.index ?? 0)));
		}
	}
	for (const match of rawPrismaMethodMatches(source))
	{
		if (_IsApprovedRawProcedureCall(path, source, classOwners, imports, match, rawProcedureCalls)) continue;
		findings.push(_Finding(path, source, match.index ?? 0, "PRISMA-RAW-QUERY-FORBIDDEN", `${match.method} is forbidden in production TypeScript; use typed Prisma delegates behind a policy-authorized Repository adapter`, ownerIdentity(source, classOwners, match.index ?? 0)));
	}
	for (const match of delegateMatches(source, modelDelegates, imports))
	{
		if (exemption.has("delegate")) continue;
		const owner = enclosingClass(classOwners, match.index ?? 0);
		if (authorizedOwner(owner, imports, owners.repositories, path) === undefined)
		{
			findings.push(_Finding(path, source, match.index ?? 0, "PRISMA-DELEGATE-OWNER", `direct ${match.delegate}.${match.method} call outside an exact policy-authorized Repository adapter`, ownerIdentity(source, classOwners, match.index ?? 0)));
		}
	}
	for (const construction of owners.compositions.includes(path) ? [] : repositoryConstructions(source, classOwners, imports))
	{
		const policyOwner = authorizedOwner(construction.owner, imports, [...owners.repositories, ...owners.unitsOfWork], path);
		const declared = policyOwner?.constructs.some(function _Declared(candidate)
		{
			return candidate.adapter === construction.adapter && candidate.importPath === construction.importPath;
		});
		if (!declared || !isTransactionScopedConstruction(source, construction, imports))
		{
			findings.push(_Finding(path, source, construction.index, "PRISMA-REPOSITORY-CONSTRUCTION", `${construction.adapter} construction must be declared and receive the exact Prisma transaction binding`, ownerIdentity(source, classOwners, construction.index)));
		}
	}
	return findings;
}

/** Returns whether the raw call is one fixed, typed workflow persistence procedure. */
function _IsApprovedRawProcedureCall(path, source, classOwners, imports, match, rawProcedureCalls)
{
	const owner = enclosingClass(classOwners, match.index ?? 0);
	const procedure = authorizedOwner(owner, imports, rawProcedureCalls, path);
	if (procedure === undefined || procedure.method !== match.method) return false;
	const approvedSourcePin = rawProcedureSourcePin(procedure.path, procedure.adapter);
	if (approvedSourcePin === undefined || procedure.sourceSha256 !== approvedSourcePin) return false;
	if (createHash("sha256").update(source.replace(/\r\n?/gu, "\n")).digest("hex") !== approvedSourcePin) return false;
	const evidence = _RawProcedureEvidence(source, owner, imports, match, procedure);
	if (evidence === undefined) return false;
	return evidence.template.replace(/\s+/gu, " ").trim() === procedure.sqlTemplate;
}

/** Proves the raw tag's method, receiver binding, transaction guard, and SQL template. */
function _RawProcedureEvidence(source, owner, imports, match, procedure)
{
	if (owner === undefined) return undefined;
	const prismaNamespace = [...imports.entries()].find(function _PrismaNamespace([, binding]) { return binding.imported === "Prisma" && binding.importPath === "@prisma/client"; })?.[0];
	if (prismaNamespace === undefined) return undefined;
	const guard = imports.get("_RequireWorkflowTransactionClient");
	if (guard?.imported !== "_RequireWorkflowTransactionClient" || guard.importPath !== "./workflow-transaction-client") return undefined;
	const template = inspectRawProcedureCall(source, match, procedure, prismaNamespace);
	return template === undefined ? undefined : { template };
}

/** Validates that policy-declared owners and construction lists still match the live tree. */
export function validateOwnerDeclarations(path, source, owners)
{
	const findings = [];
	const classOwners = classes(source);
	const imports = importedBindings(source);
	const constructions = repositoryConstructions(source, classOwners, imports);
	for (const declaration of [...owners.repositories, ...owners.unitsOfWork].filter(function _Path(entry) { return entry.path === path; }))
	{
		const owner = classOwners.find(function _Adapter(candidate) { return candidate.name === declaration.adapter; });
		if (authorizedOwner(owner, imports, [declaration], path) === undefined)
		{
			findings.push(_Finding(path, source, 0, "PRISMA-POLICY-OWNER", `policy owner ${declaration.adapter} no longer implements its exact declared contract import`, `class:${declaration.adapter}`));
			continue;
		}
		if (owners.repositories.includes(declaration) && !repositoryAcceptsTransactionClient(source, owner, imports))
		{
			findings.push(_Finding(path, source, owner.start, "PRISMA-POLICY-OWNER", `repository owner ${declaration.adapter} constructor must accept Prisma.TransactionClient`, `class:${declaration.adapter}`));
		}
		const actual = constructions.filter(function _Owner(construction) { return construction.owner?.name === declaration.adapter; });
		const actualKeys = actual.map(_ConstructionKey).sort();
		const declaredKeys = declaration.constructs.map(_ConstructionKey).sort();
		if (JSON.stringify(actualKeys) !== JSON.stringify(declaredKeys))
		{
			findings.push(_Finding(path, source, owner.start, "PRISMA-POLICY-CONSTRUCTION", `policy construction list for ${declaration.adapter} does not match its repository construction`, `class:${declaration.adapter}`));
		}
		for (const construction of actual)
		{
			if (!isTransactionScopedConstruction(source, construction, imports))
			{
				findings.push(_Finding(path, source, construction.index, "PRISMA-POLICY-CONSTRUCTION", `${construction.adapter} must receive the exact Prisma transaction binding`, `class:${declaration.adapter}`));
			}
		}
	}
	return findings;
}

/** Validates that each policy-owned raw procedure still has its exact contract and SQL. */
export function validateRawProcedureDeclarations(path, source, rawProcedureCalls)
{
	const findings = [];
	const classOwners = classes(source);
	const imports = importedBindings(source);
	for (const declaration of rawProcedureCalls.filter(function _Path(entry) { return entry.path === path; }))
	{
		const owner = classOwners.find(function _Adapter(candidate) { return candidate.name === declaration.adapter; });
		if (authorizedOwner(owner, imports, [declaration], path) === undefined)
		{
			findings.push(_Finding(path, source, 0, "PRISMA-POLICY-RAW-PROCEDURE", `raw workflow owner ${declaration.adapter} no longer implements its exact declared contract import`, `class:${declaration.adapter}`));
			continue;
		}
		const rawMatches = rawPrismaMethodMatches(source);
		const approved = rawMatches.filter(function _Approved(match)
		{
			return _IsApprovedRawProcedureCall(path, source, classOwners, imports, match, [declaration]);
		});
		if (approved.length !== 1 || rawMatches.length !== 1)
		{
			findings.push(_Finding(path, source, owner.start, "PRISMA-POLICY-RAW-PROCEDURE", `raw workflow owner ${declaration.adapter} must contain exactly one fixed ${declaration.method} call`, `class:${declaration.adapter}`));
		}
	}
	return findings;
}

/** Extracts lower-camel Prisma delegate names from schema model and view declarations. */
export function prismaModelDelegates(schemaSources)
{
	const delegates = new Set();
	for (const source of schemaSources)
	{
		for (const match of source.matchAll(/^(?:model|view)\s+([A-Za-z][A-Za-z0-9_]*)\s*\{/gmu))
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

/** Returns the stable identity of one repository construction. */
function _ConstructionKey(construction)
{
	return `${construction.adapter}\u0000${construction.importPath}`;
}
