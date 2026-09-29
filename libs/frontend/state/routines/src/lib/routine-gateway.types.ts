import type { paths } from "@opencrane/contracts";

/** Query accepted by the authenticated routine list endpoint. */
export type RoutineListQuery = NonNullable<paths["/me/routines"]["get"]["parameters"]["query"]>;

/** Query accepted by the authenticated firing-history endpoint. */
export type RoutineFiringQuery = NonNullable<paths["/me/routines/{routineId}/firings"]["get"]["parameters"]["query"]>;

/** Body used to create one reviewed routine. */
export type RoutineCreateCommand = paths["/me/routines"]["post"]["requestBody"]["content"]["application/json"];

/** Body used to revise one routine. */
export type RoutineReviseCommand = paths["/me/routines/{routineId}/revise"]["post"]["requestBody"]["content"]["application/json"];

/** Body used by lifecycle and run-now commands. */
export type RoutineControlCommand = paths["/me/routines/{routineId}/pause"]["post"]["requestBody"]["content"]["application/json"];

/** Public schedule shape accepted by preview and command endpoints. */
export type RoutineSchedule = RoutineCreateCommand["schedule"];

/** One routine definition returned after a mutation. */
export type RoutineDefinition = paths["/me/routines"]["post"]["responses"][201]["content"]["application/json"]["routine"];

/** One authorized routine detail projection. */
export type RoutineDetails = paths["/me/routines/{routineId}"]["get"]["responses"][200]["content"]["application/json"]["routine"];

/** One page of authorized routines. */
export type RoutineListPage = paths["/me/routines"]["get"]["responses"][200]["content"]["application/json"];

/** One page of authorized firing history. */
export type RoutineFiringPage = paths["/me/routines/{routineId}/firings"]["get"]["responses"][200]["content"]["application/json"];

/** One firing decision returned by an immediate run command. */
export type RoutineFiring = paths["/me/routines/{routineId}/run-now"]["post"]["responses"][200]["content"]["application/json"]["firing"];

/** Creation choices for one destination conversation. */
export type RoutineCreationOptions = paths["/me/routines/creation-options"]["get"]["responses"][200]["content"]["application/json"];

/** Five upcoming occurrences calculated for one schedule. */
export type RoutineSchedulePreview = paths["/me/routines/schedule-preview"]["post"]["responses"][200]["content"]["application/json"];

/** One requester-only proposal projection returned by the scheduling routes. */
export type RoutineProposalReadResponse = paths["/me/routines/proposals/{proposalRef}"]["get"]["responses"][200]["content"]["application/json"];

/** Browser-safe failure categories returned by the routine adapter. */
export enum RoutineGatewayErrorKinds
{
	/** The request body or response did not satisfy the public contract. */
	InvalidRequest = "invalid_request",
	/** The session is absent or expired. */
	Unauthenticated = "unauthenticated",
	/** The current session cannot access the requested routine. */
	AccessDenied = "access_denied",
	/** The requested routine or destination is unavailable to this session. */
	NotFound = "not_found",
	/** The saved revision or lifecycle state conflicts with this command. */
	Conflict = "conflict",
	/** The server dependency could not complete the request; a mutation outcome may be committed. */
	Unavailable = "unavailable",
	/** The response or transport did not match a known public failure; a mutation outcome may be committed. */
	Unknown = "unknown",
	/** The server returned a successful status with an invalid body; a mutation may already be committed. */
	InvalidResponse = "invalid_response",
}

/** Public routine lifecycle values re-exported for feature templates and stores. */
export enum RoutineStatus
{
	/** Automatic and manual firing commands may proceed to current checks. */
	Active = "active",
	/** Automatic firing is disabled while authorized manual firing remains possible. */
	Paused = "paused",
	/** No new firing may start. */
	Retired = "retired",
}

/** Public trigger values re-exported for feature templates and stores. */
export enum RoutineFiringTrigger
{
	/** A schedule sweep selected the slot. */
	Automatic = "automatic",
	/** An authorized person requested an immediate firing. */
	Manual = "manual",
}

/** Public firing stages and outcomes re-exported for feature templates and stores. */
export enum RoutineFiringDisposition
{
	/** The firing is claimed but no run is admitted yet. */
	Preparing = "preparing",
	/** Execution is active. */
	Running = "running",
	/** Execution is waiting for input or approval. */
	Waiting = "waiting",
	/** Execution completed successfully. */
	Completed = "completed",
	/** Execution failed. */
	Failed = "failed",
	/** An authorized cancellation stopped execution. */
	Cancelled = "cancelled",
	/** The slot was consumed because another firing was unfinished. */
	SkippedOverlap = "skipped_overlap",
	/** Current permission or lifecycle checks refused the firing. */
	Refused = "refused",
	/** Execution may have caused an external effect and needs review. */
	Uncertain = "uncertain",
}

/** Public terminal run reasons re-exported for feature result presentation. */
export enum AgentRunTerminalReasons
{
	/** The run produced its accepted final result. */
	Success = "success",
	/** Policy refused the run. */
	PolicyDenied = "policy_denied",
	/** The run exhausted its budget. */
	BudgetExhausted = "budget_exhausted",
	/** Runtime processing failed. */
	RuntimeFailure = "runtime_failure",
	/** The admitted input was invalid. */
	InvalidInput = "invalid_input",
	/** The requester cancelled the run. */
	UserCancelled = "user_cancelled",
}

/** Typed browser error that carries no server error prose. */
export class RoutineGatewayError extends Error
{
	/** Stable category that feature state may branch on. */
	public readonly kind: RoutineGatewayErrorKinds;

	/** Creates a safe routine gateway error. */
	public constructor(kind: RoutineGatewayErrorKinds)
	{
		super(kind);
		this.name = "RoutineGatewayError";
		this.kind = kind;
	}
}

/** Authenticated browser port for routine reads and commands. */
export interface RoutineGateway
{
	/** Reads one sparse routine page without decoding its opaque cursor. */
	list(query?: RoutineListQuery, signal?: AbortSignal): Promise<RoutineListPage>;
	/** Reads one routine after the server checks current access. */
	read(routineId: string, signal?: AbortSignal): Promise<RoutineDetails>;
	/** Reads one sparse firing-history page without decoding its opaque cursor. */
	firings(routineId: string, query?: RoutineFiringQuery, signal?: AbortSignal): Promise<RoutineFiringPage>;
	/** Reads audience and managed-service choices for one destination. */
	creationOptions(destinationConversationId: string, signal?: AbortSignal): Promise<RoutineCreationOptions>;
	/** Reads one requester-only proposal projection after the server checks current access. */
	proposal(proposalRef: string, signal?: AbortSignal): Promise<RoutineProposalReadResponse>;
	/** Cancels one requester-owned proposal without activating a routine. */
	cancelProposal(proposalRef: string, signal?: AbortSignal): Promise<RoutineProposalReadResponse>;
	/** Calculates five upcoming occurrences without saving a routine. */
	preview(schedule: RoutineSchedule, signal?: AbortSignal): Promise<RoutineSchedulePreview>;
	/** Creates one reviewed routine. */
	create(command: RoutineCreateCommand, signal?: AbortSignal): Promise<RoutineDefinition>;
	/** Adds one immutable revision to a routine. */
	revise(routineId: string, command: RoutineReviseCommand, signal?: AbortSignal): Promise<RoutineDefinition>;
	/** Pauses automatic firings after the server checks the lifecycle revision. */
	pause(routineId: string, command: RoutineControlCommand, signal?: AbortSignal): Promise<RoutineDefinition>;
	/** Resumes automatic firings after the server checks the lifecycle revision. */
	resume(routineId: string, command: RoutineControlCommand, signal?: AbortSignal): Promise<RoutineDefinition>;
	/** Retires a routine permanently after the server checks the lifecycle revision. */
	retire(routineId: string, command: RoutineControlCommand, signal?: AbortSignal): Promise<RoutineDefinition>;
	/** Requests one immediate firing after the server checks the lifecycle revision. */
	runNow(routineId: string, command: RoutineControlCommand, signal?: AbortSignal): Promise<RoutineFiring>;
}
