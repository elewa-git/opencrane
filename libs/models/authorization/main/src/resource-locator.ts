import type { AuthorizationResourceLocator } from "./resource-locator.types.js";

/**
 * Validates that a value is a resource locator naming exactly one resource.
 *
 * Rejects an empty or whitespace-padded value, anything containing a wildcard, an inherited or
 * accessor property, and any extra field. A locator never covers a hierarchy or a pattern, so
 * accepting one of those would silently widen every grant that used it.
 * @param value - Candidate locator from a grant, request, or signed capability.
 * @returns True only for a plain object with exactly a resource kind and one identifier.
 */
export function __IsAuthorizationResourceLocator(value: unknown): value is AuthorizationResourceLocator
{
	if (typeof value !== "object" || value === null || Array.isArray(value))
	{
		return false;
	}

	const prototype = Object.getPrototypeOf(value) as object | null;
	if (prototype !== Object.prototype && prototype !== null)
	{
		return false;
	}

	const candidate = value as Record<string, unknown>;
	const keys = Reflect.ownKeys(candidate);
	const kindDescriptor = Object.getOwnPropertyDescriptor(candidate, "kind");
	const idDescriptor = Object.getOwnPropertyDescriptor(candidate, "id");
	return keys.length === 2
		&& keys.every(key => key === "kind" || key === "id")
		&& kindDescriptor?.enumerable === true
		&& "value" in kindDescriptor
		&& typeof kindDescriptor.value === "string"
		&& kindDescriptor.value.length > 0
		&& kindDescriptor.value.trim() === kindDescriptor.value
		&& kindDescriptor.value !== "*"
		&& idDescriptor?.enumerable === true
		&& "value" in idDescriptor
		&& typeof idDescriptor.value === "string"
		&& idDescriptor.value.length > 0
		&& idDescriptor.value.trim() === idDescriptor.value
		&& idDescriptor.value !== "*";
}

/**
 * Determines whether two locators name the same resource.
 *
 * Comparison is exact: an identifier that looks like a parent of another does not match it, and
 * there is no wildcard. A caller wanting hierarchy must model it as separate grants.
 * @param firstResource - First resource locator.
 * @param secondResource - Second resource locator.
 * @returns True only when kind and identifier are both exactly equal.
 */
export function __AuthorizationResourcesEqual(
	firstResource: AuthorizationResourceLocator,
	secondResource: AuthorizationResourceLocator,
): boolean
{
	return __IsAuthorizationResourceLocator(firstResource)
		&& __IsAuthorizationResourceLocator(secondResource)
		&& firstResource.kind === secondResource.kind
		&& firstResource.id === secondResource.id;
}
