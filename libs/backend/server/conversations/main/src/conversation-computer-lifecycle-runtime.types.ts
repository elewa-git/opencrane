import type { ComputerLease, ConversationComputer } from "@opencrane/contracts";
import type { AgentSandboxPodBinding } from "@opencrane/backend/server/infra/agent-sandbox";

import type { ConversationComputerCheckpointRestoreCommand } from "./conversation-computer-checkpoint.types";
import type { ConversationComputerCurrentCommand, ConversationComputerHistory } from "./conversation-computers";

/** Projection operations required by checkpoint and scheduler runtime adapters. */
export interface ConversationComputerLifecycleProjection
{
	/** Resolve trusted history coordinates for one workload-selected computer. */
	resolve(siloId: string, computerId: string): Promise<ConversationComputerCurrentCommand | null>;
	/** Enumerate bounded open computer projections. */
	enumerate(siloId: string, limit: number): Promise<readonly ConversationComputerCurrentCommand[]>;
}

/** Minimal structured failure logger used by the bounded lifecycle loop. */
export interface ConversationComputerLifecycleLogger
{
	/** Records a failed reconciliation pass without terminating the process. */
	error(value: { readonly err: unknown }, message: string): void;
}

/** Fixed runtime identity needed to reconstruct a TokenReviewed Pod binding. */
export interface ConversationComputerCheckpointRuntimeProfile
{
	/** Kubernetes namespace containing the Sandbox Pod. */
	readonly namespace: string;
	/** Release-fixed ServiceAccount used by conversation computers. */
	readonly serviceAccountName: string;
}

/** Current checked computer and lease returned by checkpoint fencing. */
export interface ConversationComputerCheckpointCurrent
{
	/** Canonical computer snapshot. */
	readonly computer: ConversationComputer;
	/** Canonical current active lease. */
	readonly lease: ComputerLease;
}

/** Constructor dependencies retained by the exact checkpoint fence. */
export interface ConversationComputerCheckpointFenceDependencies
{
	/** Resolves trusted relational coordinates. */
	readonly projections: ConversationComputerLifecycleProjection;
	/** Reads canonical Kurrent history. */
	readonly history: ConversationComputerHistory;
	/** Verifies Kubernetes claim and Pod coordinates against the lease the Pod claims. */
	readonly pods: AgentSandboxPodBinding;
	/** Supplies release-fixed workload identity. */
	readonly profile: ConversationComputerCheckpointRuntimeProfile;
}
