/** Locates class ranges and the contracts named by each implements clause. */
export function classes(source)
{
	const results = [];
	const pattern = /\bclass\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+[^\s{]+)?\s+implements\s+([^\{]+)\{/gu;
	for (const match of source.matchAll(pattern))
	{
		const open = (match.index ?? 0) + match[0].lastIndexOf("{");
		results.push({
			name: match[1],
			contracts: match[2].split(",").map(function _Trim(contract) { return contract.trim().replace(/<.*>$/u, ""); }),
			start: match.index ?? 0,
			end: _MatchingBrace(source, open),
		});
	}
	return results;
}

/** Collects local import names with their authoritative imported name and exact module path. */
export function importedBindings(source)
{
	const imports = new Map();
	for (const match of source.matchAll(/^import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+"([^"]+)";/gmu))
	{
		for (const item of match[1].split(","))
		{
			const names = item.trim().replace(/^type\s+/u, "").split(/\s+as\s+/u);
			const imported = names[0];
			const local = names.at(-1);
			if (local) imports.set(local, { imported, importPath: match[2] });
		}
	}
	return imports;
}

/** Returns the exact policy owner entry for one class, or undefined when it is unauthorized. */
export function authorizedOwner(owner, imports, allowedContracts, path)
{
	if (owner === undefined) return undefined;
	return allowedContracts.find(function _Allowed(allowed)
	{
		if (allowed.path !== path || allowed.adapter !== owner.name) return false;
		return owner.contracts.some(function _Owns(contract)
		{
			const binding = imports.get(contract);
			return binding !== undefined && allowed.contract === binding.imported && allowed.contractImportPath === binding.importPath;
		});
	});
}

/** Finds repository constructions and resolves their exact import source. */
export function repositoryConstructions(source, classCandidates, imports)
{
	const constructions = [];
	const pattern = /\bnew\s+([A-Za-z_$][\w$]*Repository)\s*\(([^)]*)\)/gu;
	for (const match of source.matchAll(pattern))
	{
		const owner = enclosingClass(classCandidates, match.index ?? 0);
		const binding = imports.get(match[1]);
		const sameFile = classCandidates.some(function _SameFile(candidate) { return candidate.name === match[1]; });
		constructions.push({
			adapter: match[1],
			argument: match[2].split(",", 1)[0].trim(),
			importPath: binding?.importPath ?? (sameFile ? "<same-file>" : "<unbound>"),
			index: match.index ?? 0,
			owner,
		});
	}
	return constructions;
}

/** Returns whether a repository receives the exact transaction binding in scope. */
export function isTransactionScopedConstruction(source, construction, imports)
{
	if (!/^(?:this\.)?[A-Za-z_$][\w$]*$/u.test(construction.argument)) return false;
	if (construction.argument.startsWith("this."))
	{
		if (construction.owner === undefined) return false;
		const property = construction.argument.slice("this.".length);
		return _TransactionClientProperties(source, construction.owner, imports).has(property);
	}
	return _TransactionCallbackBindings(source).some(function _OwnsBinding(binding)
	{
		return binding.name === construction.argument && binding.start <= construction.index && construction.index <= binding.end;
	});
}

/** Returns whether a repository constructor accepts an imported Prisma TransactionClient. */
export function repositoryAcceptsTransactionClient(source, owner, imports)
{
	if (owner === undefined) return false;
	const types = _TransactionClientTypes(imports);
	if (types.length === 0) return false;
	const body = source.slice(owner.start, owner.end + 1);
	const pattern = new RegExp(`\\bconstructor\\s*\\(\\s*[A-Za-z_$][\\w$]*\\s*:\\s*(?:${types.join("|")})\\b`, "u");
	return pattern.test(body);
}

/** Finds the smallest class body containing one source offset. */
export function enclosingClass(candidates, offset)
{
	return candidates.find(function _Contains(candidate) { return candidate.start <= offset && offset <= candidate.end; });
}

/** Returns the stable enclosing class/function name used to compare findings across revisions. */
export function ownerIdentity(source, classCandidates, offset)
{
	const classOwner = enclosingClass(classCandidates, offset);
	if (classOwner !== undefined) return `class:${classOwner.name}`;
	const pattern = /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)[^{]*\{/gu;
	for (const match of source.matchAll(pattern))
	{
		const open = (match.index ?? 0) + match[0].lastIndexOf("{");
		if ((match.index ?? 0) <= offset && offset <= _MatchingBrace(source, open)) return `function:${match[1]}`;
	}
	return "module";
}

/** Finds a class closing brace while ignoring braces in strings and comments. */
function _MatchingBrace(source, open)
{
	let depth = 0;
	let quote = "";
	let lineComment = false;
	let blockComment = false;
	for (let index = open; index < source.length; index += 1)
	{
		const character = source[index];
		const next = source[index + 1];
		if (lineComment)
		{
			if (character === "\n") lineComment = false;
			continue;
		}
		if (blockComment)
		{
			if (character === "*" && next === "/") { blockComment = false; index += 1; }
			continue;
		}
		if (quote)
		{
			if (character === "\\") { index += 1; continue; }
			if (character === quote) quote = "";
			continue;
		}
		if (character === "/" && next === "/") { lineComment = true; index += 1; continue; }
		if (character === "/" && next === "*") { blockComment = true; index += 1; continue; }
		if (character === "\"" || character === "'" || character === "`") { quote = character; continue; }
		if (character === "{") depth += 1;
		if (character === "}")
		{
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	return source.length;
}

/** Finds transaction-client properties declared by one class. */
function _TransactionClientProperties(source, owner, imports)
{
	const properties = new Set();
	const types = _TransactionClientTypes(imports);
	if (types.length === 0) return properties;
	const body = source.slice(owner.start, owner.end + 1);
	const pattern = new RegExp(`\\b([A-Za-z_$][\\w$]*)\\s*:\\s*(?:${types.join("|")})\\b`, "gu");
	for (const match of body.matchAll(pattern)) properties.add(match[1]);
	return properties;
}

/** Returns local type spellings that prove Prisma transaction-client authority. */
function _TransactionClientTypes(imports)
{
	const types = [];
	for (const [local, binding] of imports.entries())
	{
		if (binding.importPath !== "@prisma/client") continue;
		if (binding.imported === "Prisma") types.push(`${_EscapeRegex(local)}\\.TransactionClient`);
		if (binding.imported === "TransactionClient") types.push(_EscapeRegex(local));
	}
	return types;
}

/** Finds the exact callback parameter and body for each direct Prisma transaction. */
function _TransactionCallbackBindings(source)
{
	const bindings = [];
	const pattern = /\.\$transaction\s*\(\s*async\s+(?:function\s+[A-Za-z_$][\w$]*\s*)?\(\s*([A-Za-z_$][\w$]*)(?:\s*:[^,)]+)?\s*\)\s*(?::\s*[^={]+)?(?:=>\s*)?\{/gu;
	for (const match of source.matchAll(pattern))
	{
		const open = (match.index ?? 0) + match[0].lastIndexOf("{");
		bindings.push({ name: match[1], start: open, end: _MatchingBrace(source, open) });
	}
	return bindings;
}

/** Escapes a literal for inclusion in a regular expression. */
function _EscapeRegex(value)
{
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
