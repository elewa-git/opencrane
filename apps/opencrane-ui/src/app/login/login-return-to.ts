/**
 * Returns a relative Angular router URL that is safe to carry through login.
 *
 * The access guard uses this path to carry an invitation token through the full-page OIDC redirect
 * without browser storage. Rejecting absolute, protocol-relative, encoded, backslash, control-character,
 * and oversized values prevents an attacker-authored login query from becoming an open redirect.
 *
 * Called by: apps/opencrane-ui/src/app/login/login-page.component.ts for both automatic and explicit
 * login continuation.
 * @param value - Untrusted `returnTo` query value from the public login route.
 * @returns The unchanged relative URL when admitted, or `/` when it is absent or unsafe.
 */
export function _SafeLoginReturnTo(value: string | null): string
{
	if (value === null || value.length === 0 || value.length > 4_096) return "/";
	const decoded = _DecodeReturnTo(value);
	if (decoded === null || !_IsSafeRouterUrl(value) || !_IsSafeRouterUrl(decoded)) return "/";
	return value;
}

/** Decodes nested redirect encodings so encoded external-route shapes cannot bypass validation. */
function _DecodeReturnTo(value: string): string | null
{
	try
	{
		return decodeURIComponent(decodeURIComponent(value));
	}
	catch
	{
		return null;
	}
}

/** Accepts a relative router path that browsers cannot reinterpret as an external URL. */
function _IsSafeRouterUrl(value: string): boolean
{
	return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !/[\u0000-\u001f\u007f]/.test(value);
}
