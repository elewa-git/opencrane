import type { ProductAuthorizationActorKind, AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import type { ExecutionSubject } from "@opencrane/contracts";
import type { ProductAuthorizationActions, ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";

import type { RuntimeDispatchTransaction } from "./prisma-runtime-dispatch-authority.types";

/** Current actor coordinates derived from the server-admitted run snapshot. */
export interface RuntimeProductActor
{
	/** Stable local Principal resolved by the central authority. */
	readonly principalId: string;
	/** Workload actor class written into durable decision evidence. */
	readonly actorKind: Extract<ProductAuthorizationActorKind, "workload">;
	/** Stable actor identifier written into durable decision evidence. */
	readonly actorId: string;
	/** Membership revision reverified for this effect admission. */
	readonly membershipRevision: number;
}

/** One typed resource and action covered by runtime external-effect admission. */
export interface RuntimeExternalActionAuthorizationCoordinate
{
	/** Trusted resource selected by its owning domain adapter. */
	readonly resource: ProductAuthorizationResourceLocator;
	/** Central catalogue action admitted for that resource. */
	readonly action: ProductAuthorizationActions;
}

/** Authority-derived evidence that must be saved with the ToolInvocation before commit. */
export interface RuntimeExternalActionAuthorizationEvidence
{
	/** Workload actor class used by the central authority. */
	readonly actorKind: Extract<ProductAuthorizationActorKind, "workload">;
	/** Exact evidence-bound subject that the runtime may exercise for this effect. */
	readonly executionSubject: ExecutionSubject;
	/** Canonically ordered resource and action set admitted for this effect. */
	readonly coordinates: readonly RuntimeExternalActionAuthorizationCoordinate[];
	/** Canonically ordered decision digests returned by the central authority. */
	readonly decisionDigests: readonly `sha256:${string}`[];
	/** Exact AgentRevision that proposed the effect. */
	readonly agentRevisionId: string;
	/** Exact run that proposed the effect. */
	readonly runId: string;
	/** Positive run attempt that proposed the effect. */
	readonly attempt: number;
	/** Digest of the validated arguments covered by the decision. */
	readonly argumentsDigest: `sha256:${string}`;
	/** Digest of the current workload assignment that proposed the effect. */
	readonly assignmentDigest: `sha256:${string}`;
	/** Digest binding every field in this evidence object except this field itself. */
	readonly evidenceDigest: `sha256:${string}`;
}

/** AgentService lifecycle question delegated to the AgentService domain. */
export interface RuntimeAgentEffectEligibilityPort
{
	/** Checks that the exact assigned revision remains active and published. */
	isEligible(command: { readonly siloId: string; readonly agentServiceId: string; readonly agentRevisionId: string; readonly executionSubject: ExecutionSubject }): Promise<boolean>;
}

/** Signed membership question delegated to the membership authority. */
export interface RuntimeMembershipEligibilityPort
{
	/** Checks that the current signed revision still proves the full frozen execution subject. */
	isEligible(command: { readonly siloId: string; readonly executionSubject: ExecutionSubject; readonly nowEpochMs: number }): Promise<boolean>;
}

/** MCP lifecycle question delegated to the MCP domain. */
export interface RuntimeMcpEffectEligibilityPort
{
	/** Checks current publication and the exact AgentRevision assignment. */
	isEligible(command: { readonly siloId: string; readonly agentServiceId: string; readonly agentRevisionId: string; readonly toolRevisionId: string }): Promise<boolean>;
}

/** Personal-memory lifecycle question delegated to the personal-memory domain. */
export interface RuntimePersonalMemoryEffectEligibilityPort
{
	/** Checks that the frozen dataset remains active on the person's boundary. */
	isEligible(command: { readonly siloId: string; readonly datasetId: string; readonly principalId: string }): Promise<boolean>;
}

/** Persona lifecycle question delegated to the Persona domain. */
export interface RuntimePersonaEffectEligibilityPort
{
	/** Returns the current profile only while the frozen approved revision remains active. */
	findEligibleProfileId(command: { readonly siloId: string; readonly principalId: string; readonly personaRevisionId: string }): Promise<string | null>;
}

/** Domain-owned lifecycle adapters bound to one runtime candidate transaction. */
export interface RuntimeExternalActionEligibilityPorts
{
	/** Current AgentService and revision lifecycle. */
	readonly agentService: RuntimeAgentEffectEligibilityPort;
	/** Current membership and identity evidence for the exact execution subject. */
	readonly membership: RuntimeMembershipEligibilityPort;
	/** Current MCP publication and assignment. */
	readonly mcp: RuntimeMcpEffectEligibilityPort;
	/** Current personal-memory dataset lifecycle. */
	readonly personalMemory: RuntimePersonalMemoryEffectEligibilityPort;
	/** Current active Persona revision. */
	readonly persona: RuntimePersonaEffectEligibilityPort;
}

/** App-owned factory that binds every domain adapter to the dispatch transaction. */
export interface RuntimeExternalActionEligibilityFactory
{
	/** Constructs domain adapters over the exact transaction that will persist the ToolInvocation. */
	bind(transaction: RuntimeDispatchTransaction): RuntimeExternalActionEligibilityPorts;
}

/** Creates the central authorization authority over the dispatch transaction. */
export type RuntimeAuthorizationAuthorityFactory = (transaction: RuntimeDispatchTransaction) => AuthorizationAuthority;
