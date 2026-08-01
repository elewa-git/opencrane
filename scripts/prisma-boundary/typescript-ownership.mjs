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

/** Returns whether the enclosing class implements an imported ownership contract. */
export function ownsContract(owner, imports, allowedContracts)
{
	return owner !== undefined && owner.contracts.some(function _Owns(contract)
	{
		const binding = imports.get(contract);
		return binding !== undefined && allowedContracts.some(function _Allowed(allowed)
		{
			return allowed.contract === binding.imported && allowed.importPath === binding.importPath;
		});
	});
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
