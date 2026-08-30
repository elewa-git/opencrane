import type { ModelRoutingScope } from "@opencrane/contracts";
import type { AuthorizationAuthority, ProductAuthorizationActorKind, ProductAuthorizationAdmissionEvidence } from "@opencrane/backend/server/iam/authorization";

/**
 * External provider operations that must be admitted and saved before another system is changed.
 *
 * These values are persisted in `provider_effect_commands`. The executor treats the set as closed
 * and refuses an unknown value instead of guessing which external adapter to call.
 */
export enum ProviderEffectCommandKinds
{
	/** A raw provider key must reach its fixed Kubernetes Secret and the LiteLLM credential store. */
	SetByokKey = "SetByokKey",
	/** The fixed Secret must be blanked and the matching LiteLLM credential removed. */
	DeleteByokKey = "DeleteByokKey",
	/** A committed model definition must be reconciled with one LiteLLM deployment. */
	RegisterModel = "RegisterModel",
}

/**
 * Delivery states for a saved provider command.
 *
 * The Prisma adapter stores these values. `Pending` and `AwaitingMaterial` may be claimed,
 * `Claimed` carries a leased fence, and the two completion states cannot execute again.
 */
export enum ProviderEffectCommandStates
{
	/** Stored arguments are sufficient for an executor to try the command. */
	Pending = "Pending",
	/** The command needs the matching provider key supplied in memory before it can run. */
	AwaitingMaterial = "AwaitingMaterial",
	/** One executor holds the command until its claim lease expires. */
	Claimed = "Claimed",
	/** The external change and its database result have both completed. Terminal. */
	Succeeded = "Succeeded",
	/** The command used every delivery attempt without completing. Terminal. */
	Failed = "Failed",
}

/**
 * Secret-material requirements saved with provider commands.
 *
 * The value is persisted and decides whether a retry can run from database state alone. An unknown
 * value fails closed because an executor must never infer where secret material came from.
 */
export enum ProviderEffectMaterialRequirements
{
	/** The command contains every non-secret argument needed for an automatic retry. */
	None = "None",
	/** A caller must resubmit a provider key that matches the command-bound verifier. */
	EphemeralProviderKey = "EphemeralProviderKey",
}

/**
 * Outcomes returned when a caller asks the provider executor to deliver one saved command.
 *
 * These values are in-memory HTTP orchestration results and are not persisted. Callers may ask
 * again for `Busy` or `AwaitingMaterial`; the two completion outcomes need no further action.
 */
export enum ProviderEffectExecutionStatuses
{
	/** This caller owns the committed claim and may now perform the external effect. */
	Claimed = "claimed",
	/** This call completed the external effect and its database finalization. */
	Succeeded = "succeeded",
	/** Another executor owns an unexpired claim, so this caller should try later. */
	Busy = "busy",
	/** The caller must resubmit the provider key that admitted this exact command. */
	AwaitingMaterial = "awaiting_material",
	/** Stored arguments are sufficient for a later executor to retry without caller material. */
	Retryable = "retryable",
	/** A previous delivery completed the command, so no effect ran during this call. */
	AlreadySucceeded = "already_succeeded",
	/** The command exhausted its delivery budget, so an operator must make a new request. */
	Failed = "failed",
}

/** Non-secret payload persisted for a raw BYOK key write. */
export interface SetByokKeyEffectPayload
{
	/** Provider catalogue key such as `openai`. */
	readonly provider: string;
	/** Fixed Kubernetes Secret name allowed by server role-based access control. */
	readonly secretRef: string;
	/** Fixed LiteLLM credential name derived from the provider. */
	readonly litellmCredentialName: string;
}

/** Non-secret payload persisted for a raw BYOK key removal. */
export interface DeleteByokKeyEffectPayload
{
	/** Provider catalogue key whose custody must be removed. */
	readonly provider: string;
	/** Fixed Kubernetes Secret name whose value must be blanked. */
	readonly secretRef: string;
	/** Fixed LiteLLM credential name removed after custody is blanked. */
	readonly litellmCredentialName: string;
}

/** Non-secret payload persisted for one LiteLLM model registration. */
export interface RegisterModelEffectPayload
{
	/** Database model definition that owns the resulting deployment identifier. */
	readonly modelDefinitionId: string;
	/** Public name exposed through LiteLLM. */
	readonly publicModelName: string;
	/** Upstream model sent to the provider. */
	readonly upstreamModel: string;
	/** Product ownership scope stored on the model definition. */
	readonly scope: ModelRoutingScope;
	/** Owning tenant for a tenant-scoped definition, or null for a global definition. */
	readonly clusterTenant: string | null;
	/** Optional upstream API base. */
	readonly apiBase: string | null;
	/** Optional Kubernetes Secret reference that LiteLLM resolves from its environment. */
	readonly apiKeyEnvRef: string | null;
	/** Optional LiteLLM credential-store name. */
	readonly litellmCredentialName: string | null;
}

/** Closed payload union selected by {@link ProviderEffectCommandKinds}. */
export type ProviderEffectCommandPayload =
	| { readonly kind: ProviderEffectCommandKinds.SetByokKey; readonly value: SetByokKeyEffectPayload }
	| { readonly kind: ProviderEffectCommandKinds.DeleteByokKey; readonly value: DeleteByokKeyEffectPayload }
	| { readonly kind: ProviderEffectCommandKinds.RegisterModel; readonly value: RegisterModelEffectPayload };

/** Inputs saved beside an authorization decision when a provider effect is admitted. */
export interface AdmitProviderEffectCommand
{
	/** Identifier generated before authorization so secret verification can be command-bound. */
	readonly id: string;
	/** Silo derived from the trusted request host. */
	readonly siloId: string;
	/** Local Principal admitted by the central authority. */
	readonly principalId: string;
	/** Typed operation the executor may perform. */
	readonly payload: ProviderEffectCommandPayload;
	/** Product resource kind fixed before authorization. */
	readonly resourceKind: string;
	/** Product resource identifier fixed before authorization. */
	readonly resourceId: string;
	/** Version of the intended resource state this command may install. */
	readonly resourceRevision: string;
	/** Digest of all authorized non-secret arguments and the command-bound material verifier. */
	readonly argumentsDigest: `sha256:${string}`;
	/** Salted verifier for in-memory material, or null for a command with no secret argument. */
	readonly materialVerifier: `sha256:${string}` | null;
	/** Central decision evidence written by the same transaction. */
	readonly authorization: ProductAuthorizationAdmissionEvidence;
	/** Approval row that narrowed this effect, or null when organisation administration needs none. */
	readonly approvalId: string | null;
	/** Fixed control-plane profile allowed to execute this command. */
	readonly executorProfile: string;
	/** Whether the executor can retry from stored data alone. */
	readonly materialRequirement: ProviderEffectMaterialRequirements;
}

/** Saved provider command returned through the repository boundary. */
export interface ProviderEffectCommandRecord extends AdmitProviderEffectCommand
{
	/** Monotonic desired-state position within this exact governed resource. */
	readonly desiredGeneration: number;
	/** Current delivery state. */
	readonly state: ProviderEffectCommandStates;
	/** Number of external delivery claims made so far. */
	readonly deliveryCount: number;
	/** Fence held by the current executor, or null outside a claim. */
	readonly claimFence: string | null;
	/** Time after which another executor may replace a crashed claim. */
	readonly claimExpiresAt: Date | null;
}

/** Ephemeral values accepted by the executor and never written to the database. */
export interface ProviderEffectEphemeralMaterial
{
	/** Canonical provider paired with a raw key so its verifier cannot be reused across providers. */
	readonly provider?: string;
	/** Raw provider key resubmitted for a Set-BYOK command. */
	readonly providerKey?: string;
}

/** Trusted route coordinates that must match the saved command before it can be claimed. */
export interface ProviderEffectExecutionContext
{
	/** Silo derived from the current request host. */
	readonly siloId: string;
	/** Principal derived from the current authenticated session. */
	readonly principalId: string;
	/** Trusted class of actor causing this delivery attempt. */
	readonly actorKind: ProductAuthorizationActorKind;
	/** Trusted request Principal or fixed system executor identity. */
	readonly actorId: string;
	/** Resource kind expected by the route that resumes delivery. */
	readonly resourceKind: string;
	/** Resource identifier expected by the route that resumes delivery. */
	readonly resourceId: string;
	/** Executor profile composed into this control-plane process. */
	readonly executorProfile: string;
}

/** Claim result returned after a transaction chooses one delivery owner. */
export interface ProviderEffectClaimResult
{
	/** Result that controls whether the executor may call an external adapter. */
	readonly status: ProviderEffectExecutionStatuses;
	/** Claimed command when this caller won, otherwise null. */
	readonly command: ProviderEffectCommandRecord | null;
}

/** Result returned by a provider effect handler for atomic database finalization. */
export type ProviderEffectHandlerResult =
	| { readonly kind: ProviderEffectCommandKinds.SetByokKey; readonly providerCredentialId: string; readonly litellmRegistered: boolean }
	| { readonly kind: ProviderEffectCommandKinds.DeleteByokKey }
	| { readonly kind: ProviderEffectCommandKinds.RegisterModel; readonly litellmModelId: string };

/** Transaction-scoped persistence used to admit and deliver provider commands. */
export interface ProviderEffectCommandRepository
{
	/** Saves one command beside the protected database intent and central decision evidence. */
	admit(command: AdmitProviderEffectCommand): Promise<ProviderEffectCommandRecord>;
	/** Selects the oldest database-complete command that a background pass may safely resume. */
	nextRecoverable(now: Date): Promise<ProviderEffectCommandRecord | null>;
	/** Claims one command after checking delivery state and any in-memory material verifier. */
	claim(commandId: string, materialVerifier: `sha256:${string}` | null, context: ProviderEffectExecutionContext, authorization: AuthorizationAuthority, now: Date): Promise<ProviderEffectClaimResult>;
	/** Rechecks current authority, lifecycle, generation, and claim immediately before external I/O. */
	preflight(command: ProviderEffectCommandRecord, context: ProviderEffectExecutionContext, authorization: AuthorizationAuthority, now: Date): Promise<boolean>;
	/** Commits the effect result only when the caller still owns the saved fence. */
	complete(command: ProviderEffectCommandRecord, result: ProviderEffectHandlerResult, context: ProviderEffectExecutionContext, authorization: AuthorizationAuthority, completedAt: Date): Promise<ProviderEffectExecutionStatuses>;
	/** Releases a failed delivery for retry or marks it terminal when its budget is spent. */
	fail(command: ProviderEffectCommandRecord, failureCode: string): Promise<ProviderEffectExecutionStatuses>;
}

/** Opens short Serializable transactions for provider-command delivery state. */
export interface ProviderEffectCommandUnitOfWork
{
	/** Runs one repository operation with bounded serialization retries. */
	run<Result>(operation: (repository: ProviderEffectCommandRepository, authorization: AuthorizationAuthority) => Promise<Result>): Promise<Result>;
}

/** External adapter called only after a provider command claim has committed. */
export interface ProviderEffectCommandHandler
{
	/** Performs the exact typed effect named by the claimed command. */
	execute(command: ProviderEffectCommandRecord, material: ProviderEffectEphemeralMaterial): Promise<ProviderEffectHandlerResult>;
}

/** Public result of one post-commit delivery attempt. */
export interface ProviderEffectExecutionResult
{
	/** Delivery outcome that tells the route whether the operation is complete or retryable. */
	readonly status: ProviderEffectExecutionStatuses;
	/** Typed effect result when this call completed the command. */
	readonly result: ProviderEffectHandlerResult | null;
}

/** Post-commit command executor used by provider routes. */
export interface ProviderEffectCommandExecutor
{
	/** Claims, performs, and finalizes one admitted command without holding a database transaction open. */
	execute(commandId: string, material: ProviderEffectEphemeralMaterial | undefined, context: ProviderEffectExecutionContext): Promise<ProviderEffectExecutionResult>;
	/** Resumes at most one non-secret command whose persisted arguments are sufficient for delivery. */
	reconcileNext(): Promise<boolean>;
}
