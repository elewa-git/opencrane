import type { ScopeChipTones } from "@opencrane/elements/ui";
import type { RoutineDefinition, RoutineFiring } from "@opencrane/state/routines";

/** Identifies whether the shared routine form creates a definition or replaces its current revision. */
export enum RoutineEditorModes
{
	/** Creates a routine for the destination conversation supplied by the route. */
	Create = "create",
	/** Replaces the schedule and instruction while retaining the destination, audience and service. */
	Revise = "revise",
}

/** Selects the browser form used to produce a five-field schedule expression. */
export enum RoutineScheduleModes
{
	/** Runs every day at the selected local time. */
	Daily = "daily",
	/** Runs on one selected weekday at the selected local time. */
	Weekly = "weekly",
	/** Preserves and edits the server's numeric five-field expression directly. */
	Advanced = "advanced",
}

/** Describes a route-scoped routine read without replacing the server's lifecycle state. */
export enum RoutineReadStates
{
	/** No read has started. */
	Idle = "idle",
	/** The first read is pending and no protected value may be shown. */
	Loading = "loading",
	/** The latest read succeeded. */
	Ready = "ready",
	/** A refresh is pending while the previous value remains visible. */
	Refreshing = "refreshing",
	/** A refresh failed and the retained value is visibly stale. */
	RetainedError = "retained_error",
	/** A revision committed but fresh details could not be read, so stale definition fields are hidden. */
	CommittedRefreshFailed = "committed_refresh_failed",
	/** Current access was denied and all protected browser state was removed. */
	AccessChanged = "access_changed",
	/** The read failed before a protected value could be shown. */
	Unavailable = "unavailable",
}

/** Describes one explicit routine mutation in browser memory. */
export enum RoutineCommandStates
{
	/** No command is pending or awaiting a retry decision. */
	Idle = "idle",
	/** The exact command is being submitted and duplicate admission is blocked. */
	Submitting = "submitting",
	/** The server rejected stale revisions and the latest details must be reviewed. */
	Conflict = "conflict",
	/** The outcome is unknown and an explicit retry must reuse the saved command. */
	Uncertain = "uncertain",
	/** The command completed but the following detail refresh failed. */
	CommittedRefreshFailed = "committed_refresh_failed",
}

/** Reports a form submission outcome to its route without exposing transport details. */
export enum RoutineSubmitOutcomes
{
	/** The server committed or recovered the requested mutation. */
	Committed = "committed",
	/** The saved revisions changed and current details must be reloaded before another request. */
	Conflict = "conflict",
	/** The result is not known and the retained command may be retried explicitly. */
	Uncertain = "uncertain",
	/** The current route or session no longer has access. */
	AccessChanged = "access_changed",
	/** Validation or a definite dependency failure refused this request. */
	Rejected = "rejected",
}

/** Identifies the explicit control command selected on a routine detail route. */
export enum RoutineControlActions
{
	/** Stops future automatic firings until resumed. */
	Pause = "pause",
	/** Re-enables future automatic firings. */
	Resume = "resume",
	/** Permanently closes the routine to new firings. */
	Retire = "retire",
	/** Requests one immediate firing without changing the automatic schedule. */
	RunNow = "run_now",
}

/** Result of one explicit control command, including the authoritative successful response. */
export interface RoutineControlResult
{
	/** Browser outcome used by the route to decide whether a refresh is safe. */
	readonly outcome: RoutineSubmitOutcomes;
	/** Present after pause, resume, or retirement committed. */
	readonly definition?: RoutineDefinition;
	/** Present after a manual firing committed or was recovered. */
	readonly firing?: RoutineFiring;
}

/** One finite status label rendered with the shared chip component. */
export interface RoutineStatusView
{
	/** Human-readable status or result label. */
	readonly label: string;
	/** Shared semantic colour selected by the feature mapper. */
	readonly tone: ScopeChipTones;
}

/** One routine row rendered by the list screen. */
export interface RoutineListRowView
{
	/** Stable route coordinate. */
	readonly routineId: string;
	/** Current server lifecycle label. */
	readonly status: RoutineStatusView;
	/** Ownership label without inventing another person's name. */
	readonly ownershipLabel: string;
	/** Server-approved managed service label. */
	readonly serviceLabel: string;
	/** Five-field expression and named timezone for compact display. */
	readonly scheduleLabel: string;
	/** Next automatic occurrence or disabled-state copy. */
	readonly nextOccurrenceLabel: string;
	/** Latest firing summary or first-run copy. */
	readonly lastFiringLabel: string;
}

/** One participant option controlled by the routine definition form. */
export interface RoutineAudienceChoiceView
{
	/** Opaque reference returned unchanged in a create command. */
	readonly participantRef: string;
	/** Server-approved participant label. */
	readonly label: string;
	/** Whether this is the requester who must remain selected. */
	readonly isSelf: boolean;
}

/** One managed service option controlled by the routine definition form. */
export interface RoutineServiceChoiceView
{
	/** Opaque service identifier returned unchanged in a create command. */
	readonly id: string;
	/** Server-approved service label. */
	readonly label: string;
}

/** Controlled values edited by the routine definition form. */
export interface RoutineDefinitionDraft
{
	/** UI schedule mode used to produce or preserve the expression. */
	readonly scheduleMode: RoutineScheduleModes;
	/** Local time used by daily and weekly modes. */
	readonly localTime: string;
	/** Numeric weekday used by weekly mode, where zero is Sunday. */
	readonly weekday: number;
	/** Five-field numeric expression sent to the server. */
	readonly expression: string;
	/** IANA timezone sent to the server. */
	readonly timezone: string;
	/** Reviewed instruction encrypted by the server. */
	readonly instruction: string;
	/** Managed service selected during creation. */
	readonly selectedManagedServiceId: string | null;
	/** Audience references selected during creation, including the requester. */
	readonly audienceParticipantRefs: readonly string[];
}

/** Server-calculated occurrence displayed beside the matching schedule draft. */
export interface RoutinePreviewView
{
	/** Time at which the server calculated this preview. */
	readonly calculatedAtLabel: string;
	/** Normalized expression and timezone returned by the server. */
	readonly scheduleLabel: string;
	/** Five formatted instants in the returned timezone. */
	readonly occurrences: readonly string[];
}

/** Full routine definition displayed on the details route. */
export interface RoutineDetailsView
{
	/** Stable routine coordinate. */
	readonly routineId: string;
	/** Current server lifecycle label. */
	readonly status: RoutineStatusView;
	/** Ownership label without another person's identity. */
	readonly ownershipLabel: string;
	/** Current managed service label. */
	readonly serviceLabel: string;
	/** Current schedule label. */
	readonly scheduleLabel: string;
	/** Current automatic next occurrence. */
	readonly nextOccurrenceLabel: string;
	/** Current automatic previous occurrence. */
	readonly lastOccurrenceLabel: string;
	/** Decrypted instruction returned by the authorized read. */
	readonly instruction: string;
	/** Server-approved labels for the frozen audience. */
	readonly audienceLabels: readonly string[];
}

/** Server-derived command hints shown by the detail screen and rechecked by every API call. */
export interface RoutineCapabilitiesView
{
	/** Whether the current definition may be revised. */
	readonly revise: boolean;
	/** Whether automatic firing may be paused. */
	readonly pause: boolean;
	/** Whether automatic firing may be resumed. */
	readonly resume: boolean;
	/** Whether the routine may be retired permanently. */
	readonly retire: boolean;
	/** Whether a manual firing may be requested, including while automatic firing is paused. */
	readonly runNow: boolean;
}

/** One firing row displayed in routine history. */
export interface RoutineHistoryRowView
{
	/** Stable firing coordinate used as the table key. */
	readonly firingId: string;
	/** Automatic or manual trigger label. */
	readonly triggerLabel: string;
	/** Current disposition label and semantic tone. */
	readonly disposition: RoutineStatusView;
	/** Scheduled slot or manual-run copy. */
	readonly scheduledLabel: string;
	/** Completion time or current-state copy. */
	readonly finishedLabel: string;
	/** Public refusal, overlap or terminal explanation. */
	readonly reasonLabel: string;
	/** Actual settled cost or unknown copy. */
	readonly costLabel: string;
	/** Authorized result conversation, or null when no current link may be shown. */
	readonly resultConversationId: string | null;
}
