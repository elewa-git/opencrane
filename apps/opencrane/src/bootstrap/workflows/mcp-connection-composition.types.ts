import type * as k8s from "@kubernetes/client-node";

import type { McpConnectionAuthority, McpConnectionCredentialReader, McpConnectionExecutionSettlement } from "@opencrane/backend/server/gateways/mcp";

import type { OpenCraneMcpConnectionConfig } from "../configuration/mcp-connection-config.types";
import type { McpWorkflowComposition } from "./mcp-workflow-composition.types";

/** Process dependencies shared by connection commands, activation and credential cleanup. */
export interface McpConnectionCompositionDependencies
{
	/** Kubernetes client restricted to the configured credential namespace by deployment RBAC. */
	readonly coreApi: k8s.CoreV1Api;
	/** Deployment-owned credential namespace and integrity keyring location. */
	readonly config: OpenCraneMcpConnectionConfig;
	/** Existing Absurd engine and the shared standard MCP transport. */
	readonly workflows: McpWorkflowComposition;
	/** Waits for dispatched calls before the connection workflow removes credentials. */
	readonly settlement: McpConnectionExecutionSettlement;
}

/** Connection ports used by authenticated routes and the server's tool executor. */
export interface McpConnectionComposition
{
	/** Admits and revokes connections under the caller's current authority. */
	readonly authority: McpConnectionAuthority;
	/** Reads credentials after checking the saved connection and revision. */
	readonly credentials: McpConnectionCredentialReader;
}
