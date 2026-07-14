/** Deterministic scenario selected for the mock UI. */
export enum UiMockScenario
{
	/** Populated happy path matching the design handoff. */
	Default = "default",
	/** Empty list and content state. */
	Empty = "empty",
	/** Deferred read and mutation state. */
	Loading = "loading",
	/** Recoverable failure state. */
	Error = "error",
	/** Restricted member presentation. */
	Permission = "permission",
	/** Budget and capacity threshold state. */
	Limits = "limits",
	/** Session reconnect and terminal transport presentation. */
	Offline = "offline",
	/** Wrapping and overflow stress state. */
	LongContent = "long-content"
}

/** Route-access variant selected independently from the content scenario. */
export enum UiMockAccessMode
{
	/** Authenticated administrator with an active tenant. */
	Administrator = "administrator",
	/** Authenticated member with an active tenant. */
	Member = "member",
	/** Anonymous visitor redirected to sign in. */
	Anonymous = "anonymous",
	/** Authenticated user without an active tenant. */
	NoTenant = "no-tenant",
	/** Authenticated tenant user requiring first-run onboarding. */
	FirstRun = "first-run"
}
