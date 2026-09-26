import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";

import type { RoutineScheduleStartupRecovery } from "@opencrane/backend/server/agents/scheduling";
import type { RoutineTurnDispatcher } from "@opencrane/backend/server/conversations";
import type { ConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";
import type { HumanMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import type { AgentSandboxReleaseProfileConfig } from "../configuration/config.types";

/** Supplies the process services shared by routine scheduling and conversation recovery. */
export interface RoutineWorkflowExecutionContext
{
	/** Provides root database access to transaction-owning routine adapters. */
	readonly prisma: PrismaClient;
	/** Stores immutable occurrence instructions and computer lifecycle evidence. */
	readonly history: HistoryStore;
	/** Creates and inspects the SandboxClaims used by routine computers. */
	readonly customApi: k8s.CustomObjectsApi;
	/** Identifies the silo accepted by the guarded workflow engine. */
	readonly siloId: string;
	/** Supplies the deployment-selected computer profile and turn cost limit. */
	readonly profile: AgentSandboxReleaseProfileConfig;
	/** Encrypts routine instructions and conversation payloads from the mounted keyring. */
	readonly cipher: ConversationPrivatePayloadCipher;
	/** Selects the deployment's current human membership evidence authority. */
	readonly membership: HumanMembershipEvidenceConfig;
	/** Registers routine handlers and admits their transaction-bound successor tasks. */
	readonly workflows: IWorkflowEngine;
}

/** Exposes routine startup repair and recovery-only turn dispatch to process composition. */
export interface RoutineWorkflowComposition
{
	/** Repairs every active schedule head before workers begin claiming tasks. */
	readonly startup: Pick<RoutineScheduleStartupRecovery, "repairAllActiveSchedules">;
	/** Recovers an admitted routine turn without creating another run or task. */
	readonly dispatcher: RoutineTurnDispatcher;
}
