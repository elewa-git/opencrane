import type { AuthorizationResourceLocator } from "./resource-locator.types.js";

/**
 * Validates the canonical exact resource-locator shape.
 * Empty, padded, wildcard, accessor, and extra-field locators fail closed.
 * @param value - Candidate locator from a grant, request, or signed capability.
 * @returns Whether the value contains exactly one canonical kind and one exact identifier.
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
 * Determines whether two locators address the same exact resource.
 * Resource identifiers never imply hierarchy or wildcard coverage.
 * @param firstResource - First exact resource locator.
 * @param secondResource - Second exact resource locator.
 * @returns Whether both the kind and identifier are byte-for-byte equal.
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
