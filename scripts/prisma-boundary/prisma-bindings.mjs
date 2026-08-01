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

/** Finds raw-query property access rooted only in imported Prisma client symbols. */
export function rawQueryMatches(source, imports)
{
	const methodNames = ["$executeRaw", "$executeRawUnsafe", "$queryRaw", "$queryRawUnsafe"];
	const matches = [];
	const code = _CodeOnly(source);
	for (const expression of _PrismaClientExpressions(source, imports))
	{
		const root = `(?<![\\w$.])${_EscapeRegex(expression)}(?![\\w$])`;
		for (const method of methodNames)
		{
			const escapedMethod = _EscapeRegex(method);
			const dot = new RegExp(`${root}\\s*\\.\\s*${escapedMethod}\\b`, "gu");
			for (const match of code.matchAll(dot)) matches.push({ index: match.index, method });

			const computed = new RegExp(`${root}\\s*\\[\\s*([\"'])${escapedMethod}\\1\\s*\\]`, "gu");
			for (const match of source.matchAll(computed))
			{
				if (_ExpressionIsCode(code, match.index ?? 0, expression)) matches.push({ index: match.index, method });
			}

			const destructured = new RegExp(`\\bconst\\s*\\{[^}]*(?<![\\w$])${escapedMethod}(?![\\w$])[^}]*\\}\\s*=\\s*${root}`, "gu");
			for (const match of code.matchAll(destructured)) matches.push({ index: match.index, method });
		}
	}
	return _UniqueRawMatches(matches);
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

/** Resolves identifiers and class properties explicitly rooted in imported Prisma client types. */
function _PrismaClientExpressions(source, imports)
{
	const code = _CodeOnly(source);
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
	for (const match of code.matchAll(declaration))
	{
		expressions.add(match[1]);
		const prefix = code.slice(Math.max(0, (match.index ?? 0) - 40), match.index ?? 0);
		if (/\b(?:private|protected|public)\s+(?:readonly\s+)?$/u.test(prefix)) expressions.add(`this.${match[1]}`);
	}
	for (const match of code.matchAll(/\bthis\.([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/gu))
	{
		if (expressions.has(match[2])) expressions.add(`this.${match[1]}`);
	}
	for (const match of code.matchAll(/\.\$transaction\s*\(\s*async\s+(?:function\s+[A-Za-z_$][\w$]*\s*)?\(\s*([A-Za-z_$][\w$]*)/gu)) expressions.add(match[1]);
	return [...expressions];
}

/** Returns source with comments and string contents blanked while preserving offsets. */
function _CodeOnly(source)
{
	const characters = source.split("");
	let quote = "";
	let lineComment = false;
	let blockComment = false;
	for (let index = 0; index < characters.length; index += 1)
	{
		const character = source[index];
		const next = source[index + 1];
		if (lineComment)
		{
			if (character === "\n") lineComment = false;
			else characters[index] = " ";
			continue;
		}
		if (blockComment)
		{
			characters[index] = character === "\n" ? "\n" : " ";
			if (character === "*" && next === "/") { characters[index + 1] = " "; blockComment = false; index += 1; }
			continue;
		}
		if (quote)
		{
			characters[index] = character === "\n" ? "\n" : " ";
			if (character === "\\") { if (index + 1 < characters.length) characters[index + 1] = " "; index += 1; continue; }
			if (character === quote) quote = "";
			continue;
		}
		if (character === "/" && next === "/") { characters[index] = " "; characters[index + 1] = " "; lineComment = true; index += 1; continue; }
		if (character === "/" && next === "*") { characters[index] = " "; characters[index + 1] = " "; blockComment = true; index += 1; continue; }
		if (character === "\"" || character === "'" || character === "`") { characters[index] = " "; quote = character; }
	}
	return characters.join("");
}

/** Returns whether a computed-access receiver is executable code at the matched offset. */
function _ExpressionIsCode(code, index, expression)
{
	return code.slice(index, index + expression.length) === expression;
}

/** Removes duplicate raw-operation matches without hiding distinct source offsets. */
function _UniqueRawMatches(matches)
{
	const seen = new Set();
	return matches.filter(function _First(match)
	{
		const key = `${match.index ?? 0}\u0000${match.method}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** Escapes a literal for inclusion in a regular expression. */
function _EscapeRegex(value)
{
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
