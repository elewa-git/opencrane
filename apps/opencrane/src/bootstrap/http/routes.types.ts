import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import type { RequestHandler, Router } from "express";

import type { ProviderEffectCommandExecutor } from "@opencrane/backend/server/gateways/providers";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import type { RateLimitOptions } from "@opencrane/backend/server/infra/http";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import type { AgentSandboxReleaseProfileConfig, InternalRuntimeConfig } from "../configuration/config.types";
import type { ConversationGeneratedFileWorkflowComposition } from "../conversations/conversation-generated-file-workflow-composition.types";
import type { PersonalMemoryWorkflowCompositionOptions } from "../conversations/personal-memory-operation-workflow-composition.types";
import type { McpRuntimeComposition } from "../workflows/mcp-runtime-composition.types";
import type { McpWorkflowComposition } from "../workflows/mcp-workflow-composition.types";

/** One Express mount shown in the app's route catalogue. */
export interface RouteMount
{
	/** HTTP registration mode used for this mount. */
	readonly method: "get" | "use";
	/** Public or internal path owned by the route. */
	readonly path: string;
	/** Capability router or terminal request handler mounted at the path. */
	readonly handler: Router | RequestHandler;
}

/** Optional rate-limiter overrides for the shares router, used mainly by tests. */
export interface ResourceSharesRouteOptions
{
	/** Shared HTTP limiter options applied before the shares router. */
	readonly rateLimit?: RateLimitOptions;
}

/** Conversation services shared by the agent, personal-workspace and conversation route areas. */
export interface ConversationRouteDependencies
{
	/** KurrentDB history shared by conversations, computer review and the company assistant. */
	readonly history: HistoryStore;
	/** Mounted keyring file that encrypts private conversation text. */
	readonly keyringPath: string;
	/** Conversation-computer profile fixed by the release. */
	readonly sandboxProfile: AgentSandboxReleaseProfileConfig;
	/** Silo and gateway client for durable personal-memory work. */
	readonly memoryWorkflow: PersonalMemoryWorkflowCompositionOptions;
	/** Whether upload admission has a live scanner to consume new files. */
	readonly artifactScannerEnabled: boolean;
}

/** Saved MCP workflows and the tool runtime, shared by the agent, conversation and gateway areas. */
export interface ToolRouteDependencies
{
	/** Guarded workflow engine plus the saved MCP job authorities. */
	readonly workflows: McpWorkflowComposition;
	/** Tool connections, task workflow and promotion router. */
	readonly runtime: McpRuntimeComposition;
}

/** Long-lived services the product routes share, built once in index.ts and grouped by what they serve. */
export interface ProductRouteDependencies
{
	/** Main product database client. */
	readonly prisma: PrismaClient;
	/** History, keyring, computer profile and memory workflow for conversation routes. */
	readonly conversations: ConversationRouteDependencies;
	/** Saved MCP workflows and the tool runtime. */
	readonly tools: ToolRouteDependencies;
	/** Provider credential and model-registry effects. */
	readonly providerEffects: ProviderEffectCommandExecutor;
}

/** Long-lived services the workload-facing routes share, built once in index.ts. */
export interface InternalRouteDependencies
{
	/** Main product database client. */
	readonly prisma: PrismaClient;
	/** Kubernetes TokenReview client that checks each calling workload. */
	readonly authApi: k8s.AuthenticationV1Api;
	/** Frozen workload-facing configuration shared with workers and body parsing. */
	readonly config: InternalRuntimeConfig;
	/** Tool runtime whose controller and executor routers mount on this listener. */
	readonly mcpRuntime: McpRuntimeComposition;
	/** Scanner hand-off for files that conversation tools generate. */
	readonly generatedFiles: Pick<ConversationGeneratedFileWorkflowComposition, "scanAssets">;
	/** Workflow admission used by the scanner and skill-authoring routes. */
	readonly workflowExecution: Pick<IWorkflowEngine, "spawn" | "emitEventInTransaction">;
}
