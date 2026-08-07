import { extname } from "node:path";

const _ExcludedPathParts = [
	"/__tests__/",
	"/build/",
	"/coverage/",
	"/dist/",
	"/fixtures/",
	"/generated/",
	"/migrations/",
	"/node_modules/",
	"/spec/",
	"/test/",
	"/tests/",
	"/vendor/",
	"/website/public/",
];

/**
 * Return whether a repository-relative path is hand-maintained production source.
 *
 * @param {string} filePath Repository-relative path.
 * @param {string[]} sourceExtensions Extensions owned by the committed policy.
 * @returns {boolean} True when the file belongs in the growth gate.
 */
export function isProductionSource(filePath, sourceExtensions)
{
	const normalized = `/${filePath.replaceAll("\\", "/")}`;
	const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
	if (!sourceExtensions.includes(extname(fileName).toLowerCase()))
	{
		return false;
	}
	if (_ExcludedPathParts.some((part) => normalized.includes(part)))
	{
		return false;
	}
	return !(
		fileName.endsWith(".d.ts")
		|| fileName.includes(".generated.")
		|| fileName.includes(".spec.")
		|| fileName.includes(".test.")
		|| fileName.endsWith("_test.go")
		|| fileName.endsWith("Test.java")
		|| fileName.endsWith("Test.kt")
		|| fileName.endsWith("-test.sh")
		|| fileName.endsWith("-tests.sh")
		|| fileName.startsWith("test_")
	);
}

/**
 * Count logical lines without treating one trailing newline as an extra line.
 *
 * @param {string} content Source content.
 * @returns {number} Logical line count.
 */
export function lineCount(content)
{
	if (!content)
	{
		return 0;
	}
	return content.endsWith("\n")
		? content.split("\n").length - 1
		: content.split("\n").length;
}

/**
 * Validate the committed policy configuration before it can affect a review decision.
 *
 * @param {object} configuration Parsed configuration.
 */
export function validateConfiguration(configuration)
{
	if (
		configuration.version !== 1
		|| !Number.isInteger(configuration.warningLines)
		|| !Number.isInteger(configuration.maximumLines)
		|| !Number.isInteger(configuration.largeAdditionLines)
		|| !Array.isArray(configuration.sourceExtensions)
		|| !Array.isArray(configuration.exceptions)
		|| configuration.warningLines < 1
		|| configuration.maximumLines <= configuration.warningLines
		|| configuration.largeAdditionLines < 1
		|| configuration.sourceExtensions.length === 0
		|| configuration.sourceExtensions.some((extension) => (
			typeof extension !== "string"
			|| !/^\.[a-z0-9]+$/u.test(extension)
		))
		|| new Set(configuration.sourceExtensions).size !== configuration.sourceExtensions.length
	)
	{
		throw new Error("module-growth configuration has an invalid schema or threshold order");
	}
}

function _IsIsoDate(value)
{
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
	{
		return false;
	}
	const timestamp = Date.parse(`${value}T00:00:00Z`);
	return Number.isFinite(timestamp)
		&& new Date(timestamp).toISOString().slice(0, 10) === value;
}

/**
 * Resolve active exact-path exceptions and fail-closed configuration errors.
 *
 * @param {object[]} entries Configured exception entries.
 * @param {string} today ISO date used for deterministic validation.
 * @returns {{ active: Map<string, object>, errors: string[] }} Validated exception state.
 */
export function resolveExceptions(entries, today)
{
	const active = new Map();
	const errors = [];
	for (const entry of entries)
	{
		const owner = typeof entry?.owner === "string" ? entry.owner.trim() : "";
		const reason = typeof entry?.reason === "string" ? entry.reason.trim() : "";
		if (
			typeof entry?.path !== "string"
			|| entry.path.length === 0
			|| entry.path.includes("*")
			|| entry.path.startsWith("/")
			|| entry.path.split("/").includes("..")
			|| owner.length === 0
			|| reason.length < 20
			|| !_IsIsoDate(entry.expiresOn)
		)
		{
			errors.push("invalid exception: exact path, owner, 20-character reason, and YYYY-MM-DD expiry are required");
			continue;
		}
		if (entry.expiresOn < today)
		{
			errors.push(`expired exception: ${entry.path} expired on ${entry.expiresOn}`);
			continue;
		}
		active.set(entry.path, { ...entry, owner, reason });
	}
	return { active, errors };
}

/**
 * Classify one changed source file against the configured growth thresholds.
 *
 * @param {object} input Evaluation input.
 * @returns {{ level: "ERROR" | "WARN", rule: string, message: string }[]} Findings.
 */
export function evaluateGrowth(input)
{
	const findings = [];
	const grew = input.currentLines > input.baseLines;
	if (!input.exempt && input.currentLines > input.maximumLines && grew)
	{
		findings.push({
			level: "ERROR",
			rule: "MODULE-GROWTH-LIMIT",
			message: `${input.currentLines} lines exceeds the ${input.maximumLines}-line maximum and grew from ${input.baseLines}; split cohesive responsibilities or add a temporary exact-path exception`,
		});
	}
	if (
		input.addedLines > input.largeAdditionLines
		|| (input.currentLines > input.warningLines && grew)
	)
	{
		findings.push({
			level: "WARN",
			rule: "MODULE-GROWTH-REVIEW",
			message: `${input.addedLines} lines added; module grew from ${input.baseLines} to ${input.currentLines} lines — inventory responsibilities and run the maintainability review dimension`,
		});
	}
	return findings;
}
