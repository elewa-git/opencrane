import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import type { ConversationComputerToolInvocationDispatch, ConversationComputerRunAdmissionPort, ConversationToolProposalRuntimeAdmission, ConversationGeneratedFileResultRepositoryFactory, ConversationGeneratedFileOutputLinker, RoutineTurnDispatcher } from "@opencrane/backend/server/conversations";
import type { ConversationPrivatePayloadCipher, ConversationPrivatePayloadKeyringDocument } from "@opencrane/backend/server/conversations/history";
import type { HumanMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";
import type { AgentSandboxReleaseProfileConfig } from "../configuration/config.types";

/** Supplies the process services and configuration used to register conversation turn and stop workflows. */
export interface ConversationExecutionContext
{
	/** Provides database access to the workflow's persistence adapters. */
	readonly prisma: PrismaClient;
	/** Stores and reads durable conversation events. */
	readonly history: HistoryStore;
	/** Provides the workload identity and Pod clients used by this composition. */
	readonly kubernetes: {
		/** Reviews the projected token presented to the credential route. */
		readonly authApi: k8s.AuthenticationV1Api;
		/** Reads the Pod bound to a conversation computer. */
		readonly coreApi: k8s.CoreV1Api;
		/** Reads the custom resources used to resolve the computer's Pod binding. */
		readonly customApi: k8s.CustomObjectsApi;
	};
	/** Identifies the silo whose conversations these workflows serve. */
	readonly siloId: string;
	/** Supplies the sandbox identity and maximum turn cost. */
	readonly profile: AgentSandboxReleaseProfileConfig;
	/** Supplies the mounted keyring used to derive review credentials. */
	readonly keyring: ConversationPrivatePayloadKeyringDocument;
	/** Encrypts turn payloads and is shared with routine composition. */
	readonly cipher: ConversationPrivatePayloadCipher;
	/** Selects the current membership evidence authority shared with routine admission. */
	readonly membership: HumanMembershipEvidenceConfig;
	/** Admits conversation turns through the production run authority. */
	readonly runAdmission: ConversationComputerRunAdmissionPort;
	/** Recovers admitted routine turns before ordinary human admission is considered. */
	readonly routineTurns: RoutineTurnDispatcher;
	/** Admits tool invocations within the proposal transaction. */
	readonly runtimeAdmission: ConversationToolProposalRuntimeAdmission;
	/** Dispatches tool invocations from the registered turn workflow. */
	readonly toolDispatch: ConversationComputerToolInvocationDispatch;
	/** Registers durable handlers and enqueues their work. */
	readonly workflows: IWorkflowEngine;
	/** Creates repositories that resolve generated files in tool results. */
	readonly generatedFiles: ConversationGeneratedFileResultRepositoryFactory;
	/** Links generated files to conversation output. */
	readonly generatedOutput: ConversationGeneratedFileOutputLinker;
}
