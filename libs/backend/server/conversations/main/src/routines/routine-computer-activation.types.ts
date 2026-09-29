import type { RoutineComputerActivationReceipt, RoutineOccurrenceCommand, RoutineOccurrencePreparationReceipt } from "@opencrane/backend/server/agents/scheduling/contract";
import type { AgentSandboxClaimAdapter } from "@opencrane/backend/server/infra/agent-sandbox";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { ConversationComputerActivationLeasePublisher, ConversationComputerActivationProfile } from "../computers/activation/conversation-computer-activation.types";
import type { RoutineOccurrenceHistory } from "./routine-occurrence-history";
import type { RoutineOccurrenceHistoryRecord } from "./routine-occurrence-history.types";

/** Publishes only a routine's lease and receipt, with current scheduling checks before each effect. */
export interface RoutineComputerActivationProjection extends ConversationComputerActivationLeasePublisher
{
	/** Receipt from the committed lease-publication transaction, or null before that transaction. */
	readonly receipt: RoutineComputerActivationReceipt | null;
	/** Returns the saved activation receipt, or null before publication; throws after a committed refusal. */
	authorize(): Promise<RoutineComputerActivationReceipt | null>;
	/** Commits a confirmed terminal pre-admission refusal before throwing its refusal signal. */
	refuse(): Promise<never>;
}

/** Supplies the existing history, scheduling and SandboxClaim owners to occurrence activation. */
export interface RoutineComputerActivationDependencies
{
	/** Builds the lease-only transaction owner for these checked occurrence coordinates. */
	readonly projections: (command: RoutineOccurrenceCommand, preparation: RoutineOccurrencePreparationReceipt, record: RoutineOccurrenceHistoryRecord) => RoutineComputerActivationProjection;
	/** Verifies the immutable instruction record before any activation request. */
	readonly occurrences: Pick<RoutineOccurrenceHistory, "readRecord">;
	/** Reads and appends the existing computer lifecycle outside SQL retry callbacks. */
	readonly history: Pick<HistoryStore, "append" | "readHead" | "readStream">;
	/** Converges a deterministic sandbox claim without admitting model work. */
	readonly claims: Pick<AgentSandboxClaimAdapter, "claim">;
	/** Uses the deployment's selected computer profile, never model-supplied runtime settings. */
	readonly profile: ConversationComputerActivationProfile;
}
