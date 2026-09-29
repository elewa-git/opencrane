import type { ManagedExecutionEvidenceAuthorityPort } from "@opencrane/backend/server/agents/agent-services";
import type { RunAdmissionRoutineInput } from "@opencrane/backend/agents/execution/runs";
import type { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import type { AgentScope, ClaimedLeaseScope, ComputerScope } from "@opencrane/contracts";

import type { ExecutionSubjectAuthority } from "../assembly/session-assembly.types";
import type { ActiveConversationComputerLeaseReader } from "./personal-conversation-execution-subject-authority.types";

/** Exact service-owned occurrence and computer coordinates rechecked for routine admission. */
export interface ManagedRoutineExecutionSubjectCoordinates
{
	/** Stable logical run allocated for this firing before admission starts. */
	readonly runId: string;
	/** Silo, conversation, computer, and managed identity selected for the occurrence. */
	readonly computer: ComputerScope;
	/** Managed service, current published revision, and computer profile. */
	readonly agent: AgentScope;
	/** Active lease and SandboxClaim proven by occurrence preparation. */
	readonly lease: ClaimedLeaseScope;
	/** Idempotency key derived from the durable firing rather than a browser request. */
	readonly requestIdempotencyKey: string;
	/** Exact routine, revision, firing, slot, and stored requester approval provenance. */
	readonly routine: RunAdmissionRoutineInput;
}

/** Current identity, lease, Principal, and permission readers used by routine subject assembly. */
export interface ManagedRoutineExecutionSubjectDependencies
{
	/** Prepared occurrence coordinates that the command must match exactly. */
	readonly coordinates: ManagedRoutineExecutionSubjectCoordinates;
	/** Current managed identity history. */
	readonly identityHistory: Pick<AgentIdentityHistory, "loadActive">;
	/** Current active computer lease history. */
	readonly computerHistory: ActiveConversationComputerLeaseReader;
	/** Current managed execution and original-requester evidence in the admission transaction. */
	readonly executionEvidence: (transaction: Parameters<ExecutionSubjectAuthority["load"]>[2]) => ManagedExecutionEvidenceAuthorityPort;
	/** Loads the managed service's persisted Principal in the admission transaction. */
	readonly resolvePrincipalId: (transaction: Parameters<ExecutionSubjectAuthority["load"]>[2]) => Promise<string | null>;
}
