import type { PrismaClient } from "@prisma/client";
import type { ConversationComputerCredentialIssuer, ConversationComputerModelTransport, ConversationComputerProcessAuthenticator, ConversationComputerProcessResolver, ConversationComputerRealizer, ConversationComputerRunAdmissionPort, ConversationComputerToolInvocationDispatch, ConversationGeneratedFileOutputLinker, ConversationGeneratedFileResultRepositoryFactory, ConversationToolProposalRuntimeAdmission } from "@opencrane/backend/server/conversations";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";
import type { ConversationComputerReleaseProfileConfig } from "../configuration/config.types";

/** Supplies the process services and configuration used to register conversation turn and stop workflows. */
export interface ConversationExecutionContext
{
	/** Provides database access to the workflow's persistence adapters. */
	readonly prisma: PrismaClient;
	/** Stores and reads durable conversation events. */
	readonly history: HistoryStore;
	/** Identifies the silo whose conversations these workflows serve. */
	readonly siloId: string;
	/** Supplies the immutable profile identity and maximum turn cost. */
	readonly profile: ConversationComputerReleaseProfileConfig;
	/** Owns realization binding for the selected process kind. */
	readonly realizer: Pick<ConversationComputerRealizer, "bind">;
	/** Resolves the live process selected by a persisted lease. */
	readonly processes: ConversationComputerProcessResolver;
	/** Authenticates callers of the private review-credential route. */
	readonly authenticator: ConversationComputerProcessAuthenticator;
	/** Holds the model credentials selected by this deployment profile. */
	readonly credentials: ConversationComputerCredentialIssuer;
	/** Sends already-reserved model requests through the selected profile transport. */
	readonly model: ConversationComputerModelTransport;
	/** Identifies the selected model transport endpoint without granting authority. */
	readonly modelEndpoint: string;
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
