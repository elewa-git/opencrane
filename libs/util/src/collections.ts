/**
 * Small collection helpers that replace the lodash functions this repo used to import.
 *
 * lodash is CommonJS-only, which breaks the ESM build. Each function here keeps the lodash
 * signature it replaces, so migrating a call site is only an import change.
 */

/**
 * Sort a copy of an array, by one property or by the elements themselves.
 *
 * Values are compared with `localeCompare` after `String(...)`, matching `_.sortBy`. That means
 * the order is locale-sensitive and numbers sort as text, so do not use this where a stable
 * machine-readable order matters — a digest input, for example.
 *
 * Called by: `libs/backend/agents/execution/inputs/main/src/session-assembly.ts`,
 * `libs/backend/server/iam/groups/main/src/core/groups.logic.ts`,
 * `libs/backend/server/gateways/mcp/main/src/core/mcp-operator.logic.ts`.
 * @param items - Source array; it is not mutated.
 * @param key - Optional property to sort by; without it the elements are compared directly.
 * @returns A new sorted array.
 */
export function ___SortBy<T>(items: T[], key?: keyof T): T[]
{
	const copy = [...items];

	if (key)
	{
		return copy.sort(function _compare(a, b)
		{
			const aVal = String(a[key] ?? "");
			const bVal = String(b[key] ?? "");
			return aVal.localeCompare(bVal);
		});
	}

	return copy.sort(function _compare(a, b)
	{
		return String(a).localeCompare(String(b));
	});
}

/**
 * Test whether any element in an array passes a check.
 *
 * A thin wrapper over `Array.prototype.some`, kept only so a lodash call site could migrate
 * without changing shape. New code should call `.some(...)` directly.
 *
 * No caller left in this repo — grep found none outside this file. A candidate for deletion.
 * @param items - Array to test.
 * @param predicate - Called once per element.
 * @returns True when at least one element passes.
 */
export function ___SomeArray<T>(items: T[], predicate: (item: T) => boolean): boolean
{
	return items.some(predicate);
}

/**
 * Test whether any entry in a plain object passes a check.
 *
 * Mirrors the lodash `_.some(object, iteratee)` overload, which passes `(value, key)` rather
 * than just the value. Only own enumerable keys are visited.
 *
 * No caller left in this repo — grep found none outside this file. A candidate for deletion.
 * @param record - Plain object to iterate.
 * @param predicate - Called with `(value, key)`.
 * @returns True when at least one entry passes.
 */
export function ___SomeRecord<V>(record: Record<string, V>, predicate: (value: V, key: string) => boolean): boolean
{
	for (const key of Object.keys(record))
	{
		if (predicate(record[key], key))
		{
			return true;
		}
	}

	return false;
}
