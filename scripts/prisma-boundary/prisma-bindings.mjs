/** Prisma delegate methods that perform database reads or writes. */
const _DELEGATE_METHODS = ["aggregate", "count", "create", "createMany", "createManyAndReturn", "delete", "deleteMany", "findFirst", "findFirstOrThrow", "findMany", "findUnique", "findUniqueOrThrow", "groupBy", "update", "updateMany", "updateManyAndReturn", "upsert"];

/** Finds direct and aliased transaction invocations rooted in an imported Prisma client type. */
export function transactionMatches(source, imports)
{
	const matches = [...source.matchAll(/\.\$transaction\s*\(/gu)];
	for (const expression of _PrismaClientExpressions(source, imports))
	{
		const escaped = _EscapeRegex(expression);
		const aliases = [
			new RegExp(`\\bconst\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${escaped}\\.\\$transaction(?:\\.bind\\([^)]*\\))?`, "gu"),
			new RegExp(`\\bconst\\s*\\{\\s*\\$transaction\\s*(?::\\s*([A-Za-z_$][\\w$]*))?\\s*\\}\\s*=\\s*${escaped}`, "gu"),
		];
		for (const pattern of aliases)
		{
			for (const alias of source.matchAll(pattern))
			{
				const name = alias[1] ?? "$transaction";
				const call = new RegExp(`\\b${_EscapeRegex(name)}\\s*\\(`, "gu");
				for (const invocation of source.matchAll(call))
				{
					if ((invocation.index ?? 0) > (alias.index ?? 0)) matches.push(invocation);
				}
			}
		}
	}
	return matches;
}

/** Finds direct model calls plus delegate aliases/destructures rooted in Prisma clients. */
export function delegateMatches(source, modelDelegates, imports)
{
	if (modelDelegates.length === 0) return [];
	const escapedDelegates = modelDelegates.map(_EscapeRegex).join("|");
	const escapedMethods = _DELEGATE_METHODS.join("|");
	const direct = [...source.matchAll(new RegExp(`\\.(${escapedDelegates})\\.(${escapedMethods})\\s*\\(`, "gu"))]
		.map(function _Direct(match) { return { index: match.index, delegate: match[1], method: match[2] }; });
	for (const expression of _PrismaClientExpressions(source, imports))
	{
		const escaped = _EscapeRegex(expression);
		const assignment = new RegExp(`\\bconst\\s+([A-Za-z_$][\\w$]*)(?:\\s*:[^=;]+)?\\s*=\\s*${escaped}\\.(${escapedDelegates})\\b`, "gu");
		for (const alias of source.matchAll(assignment))
		{
			direct.push(..._AliasCalls(source, alias[1], alias[2], alias.index ?? 0, escapedMethods));
		}
		const destructure = new RegExp(`\\bconst\\s*\\{([^}]+)\\}\\s*=\\s*${escaped}`, "gu");
		for (const match of source.matchAll(destructure))
		{
			for (const item of match[1].split(","))
			{
				const names = item.trim().split(/\s*:\s*/u);
				if (!modelDelegates.includes(names[0])) continue;
				direct.push(..._AliasCalls(source, names[1] ?? names[0], names[0], match.index ?? 0, escapedMethods));
			}
		}
	}
	return direct;
}

/** Finds calls through one already-proven Prisma delegate alias. */
function _AliasCalls(source, alias, delegate, after, escapedMethods)
{
	const calls = [];
	const pattern = new RegExp(`\\b${_EscapeRegex(alias)}\\.(${escapedMethods})\\s*\\(`, "gu");
	for (const call of source.matchAll(pattern))
	{
		if ((call.index ?? 0) > after) calls.push({ index: call.index, delegate, method: call[1] });
	}
	return calls;
}

/** Resolves identifiers and class properties explicitly typed as imported Prisma clients. */
function _PrismaClientExpressions(source, imports)
{
	const typeNames = [];
	for (const [local, binding] of imports.entries())
	{
		if (binding.importPath !== "@prisma/client") continue;
		if (binding.imported === "PrismaClient") typeNames.push(_EscapeRegex(local));
		if (binding.imported === "Prisma") typeNames.push(`${_EscapeRegex(local)}\\.TransactionClient`);
	}
	if (typeNames.length === 0) return [];
	const expressions = new Set();
	const declaration = new RegExp(`\\b([A-Za-z_$][\\w$]*)\\s*:\\s*(?:${typeNames.join("|")})\\b`, "gu");
	for (const match of source.matchAll(declaration))
	{
		expressions.add(match[1]);
		const prefix = source.slice(Math.max(0, (match.index ?? 0) - 40), match.index ?? 0);
		if (/\b(?:private|protected|public)\s+(?:readonly\s+)?$/u.test(prefix)) expressions.add(`this.${match[1]}`);
	}
	for (const match of source.matchAll(/\bthis\.([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/gu))
	{
		if (expressions.has(match[2])) expressions.add(`this.${match[1]}`);
	}
	return [...expressions];
}

/** Escapes a literal for inclusion in a regular expression. */
function _EscapeRegex(value)
{
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
