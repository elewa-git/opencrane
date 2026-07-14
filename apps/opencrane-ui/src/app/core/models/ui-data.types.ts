/** Permission role exposed by either a live or mock UI provider. */
export enum UiRole
{
	/** Organization administrator. */
	Administrator = "administrator",
	/** Standard organization member. */
	Member = "member",
	/** Read-only organization viewer. */
	Viewer = "viewer"
}

/** Signed-in identity exposed by either a live or mock UI provider. */
export interface UiIdentity
{
	/** Stable subject identifier. */
	id: string;
	/** Display name shown in navigation and Account settings. */
	name: string;
	/** Stable handle displayed in the sidebar. */
	handle: string;
	/** Email address displayed by Account settings. */
	email: string;
	/** Department label displayed by the shell. */
	department: string;
	/** Initials used when no avatar image is supplied. */
	initials: string;
	/** Permission role used for UI presentation. */
	role: UiRole;
}

/** Provider-neutral route-access state consumed by the application shell. */
export interface UiAccessState
{
	/** Whether the visitor is authenticated. */
	authenticated: boolean;
	/** Active tenant identifier, or null when no tenant is selected. */
	tenantId: string | null;
	/** Whether the welcome flow should be shown once. */
	firstRun: boolean;
	/** Identity displayed when the visitor is authenticated. */
	identity: UiIdentity | null;
}

/** Lifecycle of the most recent provider mutation. */
export enum UiMutationPhase
{
	/** No mutation has started since initialization or reset. */
	Idle = "idle",
	/** A provider mutation is pending. */
	Pending = "pending",
	/** The last mutation completed successfully. */
	Success = "success",
	/** The last mutation failed recoverably. */
	Error = "error",
	/** The pending mutation was cancelled before it committed. */
	Cancelled = "cancelled"
}

/** Provider-neutral state of the most recent mutation. */
export interface UiMutationState
{
	/** Current lifecycle phase. */
	phase: UiMutationPhase;
	/** Stable operation name, or null while idle. */
	operation: string | null;
	/** Recoverable provider message, or null when no failure is active. */
	error: string | null;
}

/** Provider-neutral presentation flags used by feature components. */
export interface UiDataPresentationState
{
	/** Whether reads and mutations should render their loading treatment. */
	loading: boolean;
	/** Recoverable provider message, or null when no failure is active. */
	error: string | null;
	/** Whether administrator-only controls should render restricted. */
	permissionRestricted: boolean;
	/** Whether capacity and budget controls should render their limit state. */
	limitReached: boolean;
	/** Whether transport-dependent UI should render disconnected. */
	offline: boolean;
	/** Whether fixture content intentionally stresses wrapping and overflow. */
	longContent: boolean;
}
