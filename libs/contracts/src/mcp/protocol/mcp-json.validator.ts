import type { JsonValue } from "@opencrane/util";

/** Returns true when a value can cross a JSON boundary within explicit depth and node limits. */
export function _IsMcpJsonValue(value: unknown): value is JsonValue
{
	const pending: { readonly value: unknown; readonly depth: number }[] = [{ value, depth: 0 }];
	let nodes = 0;
	while (pending.length > 0)
	{
		const current = pending.pop();
		if (current === undefined)
			break;
		nodes += 1;
		if (nodes > 100_000 || current.depth > 64)
			return false;
		if (current.value === null || typeof current.value === "string" || typeof current.value === "boolean")
			continue;
		if (typeof current.value === "number")
		{
			if (!Number.isFinite(current.value))
				return false;
			continue;
		}
		if (Array.isArray(current.value))
		{
			for (const child of current.value)
				pending.push({ value: child, depth: current.depth + 1 });
			continue;
		}
		if (_IsMcpRecord(current.value))
		{
			for (const child of Object.values(current.value))
				pending.push({ value: child, depth: current.depth + 1 });
			continue;
		}
		return false;
	}
	return true;
}

/** Accepts a non-array object. */
export function _IsMcpRecord(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
