import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** Resolve the repository root from this checker's location. */
const _ROOT = fileURLToPath(new URL("../", import.meta.url));
/** Restrict the workflow-engine SDK to the adapter that owns its semantics. */
const _ABSURD_ADAPTER_PREFIX = "libs/backend/server/infra/workflows/infra_absurd/";
/** Reject imports that would turn infrastructure into product authority. */
const _DOMAIN_IMPORT = /^@opencrane\/backend\/(?:agents(?:\/|$)|server\/(?:iam|gateways)(?:\/|$))/u;
/** Match package imports without treating comments or arbitrary strings as imports. */
const _IMPORT = /^import(?:\s+type)?[\s\S]*?from\s+["'](?<specifier>[^"']+)["'];?/gmu;

/** Return every maintained TypeScript source file below a directory. */
function _TypeScriptFiles(directory)
{
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true }))
	{
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(..._TypeScriptFiles(path));
		else if (entry.isFile() && path.endsWith(".ts") && !path.includes("/__tests__/")) files.push(path);
	}
	return files;
}

/** Report imports that pierce the engine or product-authority boundary. */
function _FindViolations(root, path, source)
{
	const relativePath = relative(root, path).replaceAll("\\", "/");
	const violations = [];
	for (const match of source.matchAll(_IMPORT))
	{
		const specifier = match.groups?.specifier ?? "";
		const line = source.slice(0, match.index).split("\n").length;
		if (specifier === "absurd-sdk" && !relativePath.startsWith(_ABSURD_ADAPTER_PREFIX))
		{
			violations.push(`${relativePath}:${line} absurd-sdk may be imported only by workflows/infra_absurd`);
		}
		if (_DOMAIN_IMPORT.test(specifier))
		{
			violations.push(`${relativePath}:${line} workflows infrastructure may not import backend domain package '${specifier}'`);
		}
	}
	return violations;
}

/** Check that workflow-engine and product-authority imports remain on their permitted sides. */
export function _CheckWorkflowBoundary(root = _ROOT)
{
	const workflowRoot = join(root, "libs/backend/server/infra/workflows");
	const violations = [];
	for (const path of _TypeScriptFiles(workflowRoot))
	{
		violations.push(..._FindViolations(root, path, readFileSync(path, "utf8")));
	}
	return violations;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
{
	const violations = _CheckWorkflowBoundary();
	for (const violation of violations) console.error(`workflow-boundary: ${violation}`);
	if (violations.length > 0) process.exitCode = 1;
	else console.log("workflow-boundary: PASS");
}
