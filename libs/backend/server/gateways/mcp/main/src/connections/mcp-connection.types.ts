import type { McpCredentialRequirement, McpConnectionCommand, McpConnectionCredential, McpConnectionFailureCodes, McpConnectionProjection, McpInstallStates } from "@opencrane/contracts";
import type { AuthorizationAuthority, ManagedAuthorizationGrantRepository } from "@opencrane/backend/server/iam/authorization";
import type { IWorkflowTaskContext, IWorkflowTaskReceipt, IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";

import type { McpConnectionCredentialReadCommand } from "./mcp-connection-credential-reader.types";

/** Records whether one immutable connection generation may continue to custody, discovery, or use. */
export enum McpConnectionStates
{
	/** The admitted command still needs its credential custody result. */
	AwaitingMaterial = "awaiting-material",
	/** Credential custody committed and authenticated discovery may continue. */
	Activating = "activating",
	/** Discovery completed and current authority may admit calls through this generation. */
	Active = "active",
	/** Revocation committed, so this generation cannot admit another call. This state is terminal. */
	Revoked = "revoked",
	/** A definite activation failure ended this generation. This state is terminal. */
	Failed = "failed",
	/** Credential custody is uncertain and blocks use or replacement. This state is terminal. */
	RecoveryRequired = "recovery-required",
}

/** Selects the caller authority required by one connection command. */
export enum McpConnectionOwnerKinds
{
	/** The authenticated caller owns the installed connection. */
	Personal = "personal",
	/** A current managed-service Principal owns the connection while an administrator acts. */
	ManagedService = "managed-service",
}

/** Distinguishes accepted commands from safe idempotent and denial outcomes. */
export enum McpConnectionAdmissionOutcomes
{
	/** A new generation and its activation task committed together. */
	Admitted = "admitted",
	/** The same request key returned its original generation and task. */
	Replayed = "replayed",
	/** Current identity, install, governance, or authorization does not permit the command. */
	Denied = "denied",
	/** The request key or current generation belongs to different immutable input. */
	Conflict = "conflict",
}

/** Distinguishes an admitted revocation from its safe replay and denial outcomes. */
export enum McpConnectionRevocationOutcomes
{
	/** Revocation and its cleanup task committed together. */
	Admitted = "admitted",
	/** The same revoke key returned its original cleanup task. */
	Replayed = "replayed",
	/** Current identity, install, or authorization does not permit revocation. */
	Denied = "denied",
	/** The revoke key belongs to different immutable input. */
	Conflict = "conflict",
	/** The install has no connection generation to revoke. */
	NotFound = "not-found",
}

/**
 * Reports the durable result of removing one personal MCP installation.
 *
 * The authenticated HTTP delete route returns these string values. Renaming one is an API-breaking
 * change; the values themselves are not stored.
 */
export enum McpConnectionUninstallOutcomes
{
	/** No installation is visible to the authenticated personal owner. */
	NotFound = "not-found",
	/** Revocation or credential cleanup still owns work for a retained generation. */
	Removing = "removing",
	/** Every retained generation is settled and the installation is removed. */
	Removed = "removed",
}

/** Result of creating or recovering an immutable connection Secret. */
export enum McpConnectionSecretWriteOutcomes
{
	/** The expected immutable Secret was created. */
	Created = "created",
	/** A lost create response was recovered from the matching immutable Secret. */
	Recovered = "recovered",
	/** An object at the expected name does not match the admitted generation. */
	Conflict = "conflict",
	/** Kubernetes did not provide enough evidence to decide whether custody committed. */
	Uncertain = "uncertain",
}

/** Result of reading the immutable Secret for an already-claimed connection generation. */
export enum McpConnectionSecretReadOutcomes
{
	/** Exact metadata and bearer material matched the saved generation. */
	Found = "found",
	/** No Secret exists at the derived name. */
	NotFound = "not-found",
	/** The observed Secret or material does not match the saved generation. */
	Conflict = "conflict",
	/** Kubernetes did not provide enough evidence for a safe read decision. */
	Uncertain = "uncertain",
}

/** Result of deleting the immutable Secret for a revoked generation. */
export enum McpConnectionSecretDeleteOutcomes
{
	/** Kubernetes accepted deletion with the saved object preconditions. */
	Deleted = "deleted",
	/** The expected Secret was already absent. */
	NotFound = "not-found",
	/** The object at the derived name no longer matches the saved identity. */
	Conflict = "conflict",
	/** Kubernetes did not provide enough evidence to decide whether cleanup committed. */
	Uncertain = "uncertain",
}

/** Caller and target selected before a connection command enters its transaction. */
export interface McpConnectionActor
{
	/** Silo derived from the authenticated host and current membership. */
	readonly siloId: string;
	/** Authenticated local Principal that performs this command. */
	readonly actorPrincipalId: string;
	/** Selects personal or managed-service ownership. */
	readonly ownerKind: McpConnectionOwnerKinds;
	/** Managed service selected by the route; absent for personal ownership. */
	readonly agentServiceId?: string;
}

/** Complete write-only request after route validation. */
export interface McpConnectionAdmissionCommand
{
	/** Authenticated actor and requested ownership mode. */
	readonly actor: McpConnectionActor;
	/** Published installed MCP server selected by the route. */
	readonly serverId: string;
	/** Ephemeral command; only its digests may cross the admission transaction. */
	readonly command: McpConnectionCommand;
}

/** Request to revoke the current generation without accepting credential material. */
export interface McpConnectionRevocationCommand
{
	/** Authenticated actor and requested ownership mode. */
	readonly actor: McpConnectionActor;
	/** Installed MCP server selected by the route. */
	readonly serverId: string;
	/** Caller key that returns the same admitted cleanup after an uncertain response. */
	readonly idempotencyKey: string;
	/** Generation observed by the caller before it requested revocation. */
	readonly expectedGeneration: number;
}

/** Personal uninstall request derived entirely from the authenticated route. */
export interface McpConnectionUninstallCommand
{
	/** Silo derived from the authenticated host and current membership. */
	readonly siloId: string;
	/** Authenticated personal Principal that owns the installation. */
	readonly actorPrincipalId: string;
	/** Installed MCP server selected by the route. */
	readonly serverId: string;
}

/** Durable install selected while its owner-scoped admission row is held. */
export interface McpConnectionRemovalTarget
{
	/** Stable installation retained across removal and reinstall. */
	readonly installId: string;
	/** Server selected by the authenticated request. */
	readonly serverId: string;
	/** Personal Principal that owns this installation. */
	readonly ownerPrincipalId: string;
	/** Current install lifecycle observed under the install lock. */
	readonly lifecycleState: McpInstallStates;
}

/** Current managed service identity resolved inside the admission transaction. */
export interface McpConnectionManagedServiceIdentity
{
	/** Managed service whose current Principal owns the connection. */
	readonly agentServiceId: string;
	/** Current internal Principal derived from the published managed service. */
	readonly principalId: string;
}

/** Resolves current managed-service identity from the same transaction as admission. */
export interface McpConnectionManagedServiceResolver
{
	/** Return the current internal Principal, or null when the service is not currently usable. */
	resolve(siloId: string, agentServiceId: string): Promise<McpConnectionManagedServiceIdentity | null>;
}

/** Current install and registered server facts required before a generation can be admitted. */
export interface McpConnectionInstallTarget
{
	/** Stable install row referenced by the connection relation, or null before a managed install is admitted. */
	readonly installId: string | null;
	/** Installed server selected by the route. */
	readonly serverId: string;
	/** Exact Principal that owns the install. */
	readonly ownerPrincipalId: string;
	/** Registered HTTPS endpoint used only by the authenticated discovery owner. */
	readonly endpoint: string;
	/** Explicit credential contract registered independently of presentation type. */
	readonly credentialRequirement: McpCredentialRequirement;
}

/** Workflow coordinates persisted with one connection generation. */
export interface McpConnectionTaskBinding
{
	/** Workflow engine identifier. */
	readonly taskId: string;
	/** Registered task name. */
	readonly taskName: string;
	/** Stable task key derived from non-secret generation coordinates. */
	readonly taskKey: string;
}

/** Saved connection row without raw credential material. */
export interface McpConnectionRecord
{
	readonly id: string;
	readonly siloId: string;
	readonly installId: string;
	readonly serverId: string;
	readonly ownerPrincipalId: string;
	readonly actorPrincipalId: string;
	readonly agentServiceId: string | null;
	readonly generation: number;
	readonly credentialRequirement: McpCredentialRequirement;
	readonly credentialKind: McpConnectionCredential["kind"];
	readonly endpointDigest: `sha256:${string}`;
	readonly state: McpConnectionStates;
	readonly requestKeyDigest: `sha256:${string}`;
	readonly commandDigest: `sha256:${string}`;
	readonly materialVerifier: `hmac-sha256:${string}` | null;
	readonly materialVerifierKeyId: string | null;
	readonly authorizationDecisionDigest: `sha256:${string}`;
	readonly secretRef: string | null;
	readonly secretUid: string | null;
	readonly secretResourceVersion: string | null;
	readonly credentialCustodiedAt: Date | null;
	readonly task: McpConnectionTaskBinding;
	readonly revokeKeyDigest: `sha256:${string}` | null;
	readonly revokeDecisionDigest: `sha256:${string}` | null;
	readonly revokeTask: McpConnectionTaskBinding | null;
	readonly failureCode: McpConnectionFailureCodes | null;
	readonly activatedAt: Date | null;
	readonly revokedAt: Date | null;
	readonly cleanupCompletedAt: Date | null;
}

/** Non-secret task input saved by the workflow engine. */
export interface McpConnectionActivationTaskInput
{
	readonly siloId: string;
	readonly connectionId: string;
	readonly generation: number;
	readonly commandDigest: `sha256:${string}`;
}

/** Non-secret cleanup input saved by the workflow engine. */
export interface McpConnectionRevocationTaskInput
{
	readonly siloId: string;
	readonly connectionId: string;
	readonly generation: number;
	readonly commandDigest: `sha256:${string}`;
}

/** Admits activation and cleanup tasks inside the caller's SQL transaction. */
export interface McpConnectionWorkflowAdmission
{
	/** Save one activation task without receiving endpoint or credential material. */
	admitActivation(transaction: IWorkflowTransaction, input: McpConnectionActivationTaskInput): Promise<McpConnectionTaskBinding>;
	/** Save one cleanup task without receiving endpoint, Secret, or credential material. */
	admitRevocation(transaction: IWorkflowTransaction, input: McpConnectionRevocationTaskInput): Promise<McpConnectionTaskBinding>;
}

/** Runs connection activation and cleanup from their saved non-secret task inputs. */
export interface McpConnectionWorkflowController
{
	/** Continue custody verification and authenticated discovery for one admitted generation. */
	activate(context: IWorkflowTaskContext, input: McpConnectionActivationTaskInput): Promise<void>;
	/** Delete only the saved immutable Secret after the revoked generation has settled. */
	revoke(context: IWorkflowTaskContext, input: McpConnectionRevocationTaskInput): Promise<void>;
}

/** Transaction-scoped persistence required by connection admission and revocation. */
export interface McpConnectionRepository
{
	lockInstall(siloId: string, serverId: string, ownerPrincipalId: string): Promise<McpConnectionInstallTarget | null>;
	lockInstallForRevocation(siloId: string, serverId: string, ownerPrincipalId: string): Promise<McpConnectionInstallTarget | null>;
	lockInstallForRemoval(siloId: string, serverId: string, ownerPrincipalId: string): Promise<McpConnectionRemovalTarget | null>;
	createManagedInstall(target: McpConnectionInstallTarget): Promise<McpConnectionInstallTarget | null>;
	findByRequestKey(siloId: string, installId: string, requestKeyDigest: `sha256:${string}`): Promise<McpConnectionRecord | null>;
	findByRevokeKey(siloId: string, installId: string, revokeKeyDigest: `sha256:${string}`): Promise<McpConnectionRecord | null>;
	lockCurrent(siloId: string, installId: string): Promise<McpConnectionRecord | null>;
	loadActivationRecord(input: McpConnectionActivationTaskInput, task: IWorkflowTaskReceipt): Promise<McpConnectionRecord | null>;
	loadActivationTarget(input: McpConnectionActivationTaskInput, task: IWorkflowTaskReceipt): Promise<{ readonly record: McpConnectionRecord; readonly endpoint: string } | null>;
	loadRevocationTarget(input: McpConnectionRevocationTaskInput, task: IWorkflowTaskReceipt): Promise<McpConnectionRecord | null>;
	readExecutionCredential(command: McpConnectionCredentialReadCommand): Promise<McpConnectionRecord | null>;
	create(record: Omit<McpConnectionRecord, "secretRef" | "secretUid" | "secretResourceVersion" | "credentialCustodiedAt" | "revokeKeyDigest" | "revokeDecisionDigest" | "revokeTask" | "failureCode" | "activatedAt" | "revokedAt" | "cleanupCompletedAt">): Promise<McpConnectionRecord>;
	markRevoked(record: McpConnectionRecord, command: { readonly actorPrincipalId: string; readonly revokeKeyDigest: `sha256:${string}`; readonly revokeDecisionDigest: `sha256:${string}`; readonly task: McpConnectionTaskBinding; readonly now: Date }): Promise<McpConnectionRecord | null>;
	bindCustody(record: McpConnectionRecord, binding: McpConnectionSecretIdentity | null, now: Date): Promise<McpConnectionRecord | null>;
	markRecoveryRequired(record: McpConnectionRecord, failureCode: McpConnectionFailureCodes, now: Date): Promise<McpConnectionRecord | null>;
	markActivationFailed(record: McpConnectionRecord, failureCode: McpConnectionFailureCodes, now: Date): Promise<McpConnectionRecord | null>;
	markCleanupFailed(record: McpConnectionRecord, failureCode: McpConnectionFailureCodes, now: Date): Promise<McpConnectionRecord | null>;
	markCleanupComplete(record: McpConnectionRecord, now: Date): Promise<McpConnectionRecord | null>;
	setInstallProjection(installId: string, projection: McpConnectionProjection): Promise<void>;
}

/** Transaction-scoped persistence for the retained installation removal lifecycle. */
export interface McpInstallRemovalRepository
{
	/** Lock an Installed or Removing install before cleanup changes one of its retained generations. */
	lockForCleanup(installId: string): Promise<McpInstallStates | null>;
	/** Remove an installed row only when it has no retained connection generation. */
	markRemovedWithoutConnection(installId: string): Promise<boolean>;
	/** Move an installed row into removal without accepting late connection work. */
	markRemoving(installId: string): Promise<boolean>;
	/** Mark removal complete only after every retained generation has finished cleanup. */
	markRemovedIfSettled(installId: string): Promise<boolean>;
}

/** Writes the user-visible audit record for the first durable install-removal transition. */
export interface McpInstallAuditRepository
{
	/** Record one uninstall after its lifecycle change succeeds in the same transaction. */
	appendUninstalled(siloId: string, serverId: string, ownerPrincipalId: string, actorPrincipalId: string): Promise<void>;
}

/** Checks whether every dispatch claim on a revoked generation has reached a terminal outcome. */
export interface McpConnectionExecutionSettlement
{
	/** Return true only when cleanup cannot race an already-admitted provider call. */
	isSettled(record: McpConnectionRecord): Promise<boolean>;
}

/** Repositories constructed from the same Prisma transaction attempt. */
export interface McpConnectionTransaction
{
	readonly connections: McpConnectionRepository;
	readonly installRemoval: McpInstallRemovalRepository;
	readonly installAudit: McpInstallAuditRepository;
	readonly authorization: AuthorizationAuthority;
	readonly grants: ManagedAuthorizationGrantRepository;
	readonly managedServices: McpConnectionManagedServiceResolver;
	readonly workflow: McpConnectionWorkflowAdmission;
	readonly workflowTransaction: IWorkflowTransaction;
}

/** Owns the Serializable transaction and transaction-scoped MCP connection repositories. */
export interface McpConnectionAdmissionUnitOfWork
{
	execute<Result>(operation: (transaction: McpConnectionTransaction) => Promise<Result>): Promise<Result>;
}

/** Successful or rejected admission result returned before credential custody. */
export type McpConnectionAdmissionResult =
	| { readonly outcome: McpConnectionAdmissionOutcomes.Admitted | McpConnectionAdmissionOutcomes.Replayed; readonly record: McpConnectionRecord }
	| { readonly outcome: McpConnectionAdmissionOutcomes.Denied | McpConnectionAdmissionOutcomes.Conflict };

/** Successful or rejected revocation result returned after its SQL decision. */
export type McpConnectionRevocationResult =
	| { readonly outcome: McpConnectionRevocationOutcomes.Admitted | McpConnectionRevocationOutcomes.Replayed; readonly record: McpConnectionRecord }
	| { readonly outcome: McpConnectionRevocationOutcomes.Denied | McpConnectionRevocationOutcomes.Conflict | McpConnectionRevocationOutcomes.NotFound };

/** Lifecycle result returned by personal uninstall without exposing connection evidence. */
export interface McpConnectionUninstallResult
{
	/** Tells the route whether removal is absent, still running, or complete. */
	readonly outcome: McpConnectionUninstallOutcomes;
}

/** Immutable identity saved after Kubernetes credential custody succeeds. */
export interface McpConnectionSecretIdentity
{
	readonly secretRef: string;
	readonly secretUid: string;
	readonly secretResourceVersion: string;
}

/** Coordinates used to derive and verify one immutable connection Secret. */
export interface McpConnectionSecretTarget
{
	readonly connectionId: string;
	readonly siloId: string;
	readonly ownerPrincipalId: string;
	readonly generation: number;
	readonly endpointDigest: `sha256:${string}`;
	readonly materialVerifier: `hmac-sha256:${string}`;
	readonly materialVerifierKeyId: string;
	readonly expectedIdentity?: McpConnectionSecretIdentity;
}

/** Immutable Secret write result without credential material. */
export type McpConnectionSecretWriteResult =
	| { readonly outcome: McpConnectionSecretWriteOutcomes.Created | McpConnectionSecretWriteOutcomes.Recovered; readonly identity: McpConnectionSecretIdentity }
	| { readonly outcome: McpConnectionSecretWriteOutcomes.Conflict | McpConnectionSecretWriteOutcomes.Uncertain };

/** Exact Secret read result; bearer material must remain in the immediate caller only. */
export type McpConnectionSecretReadResult =
	| { readonly outcome: McpConnectionSecretReadOutcomes.Found; readonly bearerToken: string }
	| { readonly outcome: McpConnectionSecretReadOutcomes.NotFound | McpConnectionSecretReadOutcomes.Conflict | McpConnectionSecretReadOutcomes.Uncertain };

/** Secret identity recovered from saved HMAC and metadata after an interrupted SQL bind. */
export type McpConnectionSecretRecoveryResult =
	| { readonly outcome: McpConnectionSecretReadOutcomes.Found; readonly identity: McpConnectionSecretIdentity }
	| { readonly outcome: McpConnectionSecretReadOutcomes.NotFound | McpConnectionSecretReadOutcomes.Conflict | McpConnectionSecretReadOutcomes.Uncertain };

/** Exact Secret delete result. */
export interface McpConnectionSecretDeleteResult
{
	readonly outcome: McpConnectionSecretDeleteOutcomes;
}

/** Kubernetes custody port restricted to one configured MCP credential namespace. */
export interface McpConnectionCredentialSecretStore
{
	createOrRecover(target: McpConnectionSecretTarget, bearerToken: string): Promise<McpConnectionSecretWriteResult>;
	recoverIdentity(target: McpConnectionSecretTarget): Promise<McpConnectionSecretRecoveryResult>;
	readExact(target: McpConnectionSecretTarget, signal?: AbortSignal): Promise<McpConnectionSecretReadResult>;
	deleteExact(target: McpConnectionSecretTarget): Promise<McpConnectionSecretDeleteResult>;
}

/** Current and historical HMAC operations for material that must never be retained in SQL. */
export interface McpConnectionMaterialVerifier
{
	current(material: string): { readonly keyId: string; readonly verifier: `hmac-sha256:${string}` };
	verify(keyId: string, material: string, expected: `hmac-sha256:${string}`): boolean;
}

/** Public command service used by the authenticated HTTP routes. */
export interface McpConnectionAuthority
{
	connect(command: McpConnectionAdmissionCommand): Promise<McpConnectionProjection | null>;
	revoke(command: McpConnectionRevocationCommand): Promise<McpConnectionProjection | null>;
	/** Remove a personal install while retaining generations until their cleanup is proven. */
	uninstall(command: McpConnectionUninstallCommand): Promise<McpConnectionUninstallResult>;
}
