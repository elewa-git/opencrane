import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import type { ConversationComputerToolInvocationDispatch, ConversationComputerRunAdmissionPort, ConversationToolProposalRuntimeAdmission, ConversationGeneratedFileResultRepositoryFactory, ConversationGeneratedFileOutputLinker } from "@opencrane/backend/server/conversations";
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
	/** Locates the keyring used for private payload encryption and review credentials. */
	readonly keyringPath: string;
	/** Admits conversation turns through the production run authority. */
	readonly runAdmission: ConversationComputerRunAdmissionPort;
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
