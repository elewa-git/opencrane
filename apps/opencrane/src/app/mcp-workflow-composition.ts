import type { PrismaClient } from "@prisma/client";

import { _CreateArtifactCatalogueRepository } from "@opencrane/backend/server/agents/artifacts";
import { SkillAuthoringValidationTaskDeclaration } from "@opencrane/backend/agents/skills/workflows/contract";
import { __CreateMcpbBundleVerifier, __CreateMcpbValidationWorkflow, __CreateMcpEraProbeWorkflow, __CreateMcpTaskWorkflow, MCP_ERA_PROTOCOL_VERSION, McpEraProbeFailure, McpEraProbeFailureCodes, McpEraProbeTaskNames, McpbValidationTaskNames, McpTaskTaskNames, PrismaMcpOperatorUnitOfWork } from "@opencrane/backend/server/gateways/mcp";
import type { McpEraProbeClient, McpbBundleArtifactResolver } from "@opencrane/backend/server/gateways/mcp";
import { __CreateHttpsMcpEraProbeClient, McpEraProbeConfigurationError, McpEraProbeProtocolError, McpEraProbeTransportError } from "@opencrane/backend/server/infra/mcp-era-probe";
import { _CreateAbsurdWorkflowEngine } from "@opencrane/backend/server/infra/workflows/infra_absurd";
import { __CreateWorkflowGuard, __CreateWorkflowTaskQueueAuthority } from "@opencrane/backend/server/infra/workflows/guard";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import { _CreatePublishedArtifactReader } from "../infra/artifacts/artifact-upload.factory";
import type { OpenCraneWorkflowConfig } from "./config.types";
import { _log } from "./log";
import type { McpWorkflowComposition } from "./mcp-workflow-composition.types";

/** Translate infrastructure failures into the bounded outcomes owned by the MCP domain. */
export function _McpEraProbeFailure(error: unknown): McpEraProbeFailure
{
	if (error instanceof McpEraProbeConfigurationError)
		return new McpEraProbeFailure(McpEraProbeFailureCodes.UnsafeEndpoint);
	if (error instanceof McpEraProbeProtocolError)
		return new McpEraProbeFailure(McpEraProbeFailureCodes.InvalidResponse);
	if (error instanceof McpEraProbeTransportError)
	{
		const status = error.code.startsWith("http_") ? Number(error.code.slice(5)) : null;
		if (error.code === "network" || error.code === "timeout" || status === 429 || (status !== null && status >= 500))
			return new McpEraProbeFailure(McpEraProbeFailureCodes.RetryableUnavailable);
		return new McpEraProbeFailure(McpEraProbeFailureCodes.InvalidResponse);
	}
	throw error;
}

/**
 * Declares the remote skill task before an application transaction may save its receipt.
 *
 * Declaration permits transaction-bound admission but installs no server handler. Called by:
 * {@link _CreateMcpWorkflowComposition}; a later product adapter supplies the validation schema,
 * repository, and route that invoke admission.
 *
 * @param execution - Supplies the guarded engine that owns declared task names.
 */
export function __DeclareSkillAuthoringValidation(execution: Pick<IWorkflowEngine, "declare">): void
{
	execution.declare(SkillAuthoringValidationTaskDeclaration);
}

/**
 * Creates the guarded Absurd engine that the server's durable domain workflows share.
 *
 * The server declares the skill-authoring task on its queue without adding a local handler. That
 * lets a product transaction admit the task while the controller remains responsible for executing
 * the Kubernetes-mutating definition. The private controller lifecycle API is mounted, but the
 * product admission adapter and deployable controller-handler registration are still pending.
 *
 * @see SkillAuthoringValidationTaskDeclaration — defines the declaration the controller shares.
 */
export function _CreateMcpWorkflowComposition(prisma: PrismaClient, config: OpenCraneWorkflowConfig): McpWorkflowComposition
{
	const queueAuthority = __CreateWorkflowTaskQueueAuthority([
		{ taskName: McpEraProbeTaskNames.Probe, queue: "control-plane" },
		{ taskName: McpbValidationTaskNames.Verify, queue: "control-plane" },
		{ taskName: McpbValidationTaskNames.Inspect, queue: "mcpb-inspection" },
		{ taskName: McpTaskTaskNames.Call, queue: "control-plane" },
		{ taskName: SkillAuthoringValidationTaskDeclaration.taskName, queue: "skill-authoring" },
	]);
	const runtime = _CreateAbsurdWorkflowEngine({ databasePoolSize: config.databasePoolSize, databaseUrl: config.databaseUrl, log: _log, pollIntervalMs: config.pollIntervalMilliseconds, queueAuthority, workerConcurrency: config.workerConcurrency });
	const execution = __CreateWorkflowGuard({ execution: runtime, log: _log, queueAuthority, siloId: config.siloId });
	__DeclareSkillAuthoringValidation(execution);
	const transport = __CreateHttpsMcpEraProbeClient({ protocolVersion: MCP_ERA_PROTOCOL_VERSION, maximumResponseBytes: config.mcpEraProbeMaximumResponseBytes, requestTimeoutMilliseconds: config.mcpEraProbeTimeoutMilliseconds });
	const probe: McpEraProbeClient = {
		async probe(request)
		{
			try { return await transport.probe(request); }
			catch (error) { throw _McpEraProbeFailure(error); }
		},
	};
	const unitOfWork = new PrismaMcpOperatorUnitOfWork(prisma);
	const eraProbeWorkflow = __CreateMcpEraProbeWorkflow({ execution, probe, unitOfWork });
	const mcpbValidationWorkflow = __CreateMcpbValidationWorkflow({ execution, verifier: __CreateMcpbBundleVerifier(_CreatePublishedArtifactReader(prisma)), unitOfWork });
	const mcpTaskWorkflow = __CreateMcpTaskWorkflow({ execution, unitOfWork });
	const artifactCatalogue = _CreateArtifactCatalogueRepository(prisma);
	const mcpbArtifacts: McpbBundleArtifactResolver = {
		async resolve(siloId, artifactId, artifactRevisionId)
		{
			return await artifactCatalogue.loadPublishedReadTarget({ siloId, artifactId, artifactRevisionId });
		},
	};
	return { execution, runtime, unitOfWork, eraProbeWorkflow, mcpbValidationWorkflow, mcpTaskWorkflow, mcpbArtifacts };
}
