/** A session row in the sidebar lists. */
export interface SessionSummary
{
	/** Stable session id (doubles as thread id). */
	id: string;
	/** Session display name. */
	name: string;
	/** Session accent colour (dot + active border). */
	color: string;
	/** Department key used for sidebar grouping. */
	dept: string;
	/** Optional secondary line under the name. */
	subtitle?: string;
	/** Unread message count badge. */
	unread?: number;
	/** Whether the session belongs to the current user. */
	mine: boolean;
	/** Owning pod id (e.g. "alex.oc"). */
	pod: string;
}

/** An automation run row in the sidebar. */
export interface AutomationRun
{
	/** Stable run id. */
	id: string;
	/** Run display name. */
	name: string;
	/** Run status ("running" | "done"). */
	status: string;
	/** Department key, or "org" for org-wide runs. */
	dept: string;
}

/** A teammate available in the share panel. */
export interface Teammate
{
	/** Stable user id. */
	id: string;
	/** Full display name. */
	name: string;
	/** Department label. */
	dept: string;
	/** Avatar initials. */
	initials: string;
	/** Avatar background colour. */
	color: string;
}

/** A shared-session target in the share panel. */
export interface ShareTarget
{
	/** Stable session id. */
	id: string;
	/** Session name. */
	name: string;
	/** Department label. */
	dept: string;
}
