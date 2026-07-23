/** Return whether a runtime value is a non-empty object-shaped personal configuration patch. */
export function _IsPersonalConfigurationPatch(value: unknown): value is Readonly<Record<string, unknown>>
{
	return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}
