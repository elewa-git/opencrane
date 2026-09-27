/** Accepts one bounded opaque route coordinate without interpreting its identity. */
export function _RouteCoordinate(value: string | null): string | null
{
	if (value === null || value.length === 0 || value.length > 200 || value.trim() !== value)
		return null;
	return value;
}
