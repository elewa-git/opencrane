import { readFile } from "node:fs/promises";

import type { PrismaClient } from "@prisma/client";

import { _CreateArtifactCatalogueRepository } from "@opencrane/backend/server/agents/artifacts";
import { SkillAuthoringValidationTaskDeclaration } from "@opencrane/backend/agents/skills/workflows/contract";
import { __CreateOciImageLayoutImporter, __CreateOciImageLayoutVerifier, __CreateOciImageValidationWorkflow, __CreateMcpEraProbeWorkflow, MCP_ERA_PROTOCOL_VERSION, McpEraProbeFailure, McpEraProbeFailureCodes, McpEraProbeTaskNames, OciImageValidationTaskNames, PrismaMcpOperatorUnitOfWork } from "@opencrane/backend/server/gateways/mcp";
import type { McpEraProbeClient, OciImageLayoutArtifactResolver } from "@opencrane/backend/server/gateways/mcp";
import { __CreateHttpsMcpEraProbeClient, McpEraProbeConfigurationError, McpEraProbeProtocolError, McpEraProbeTransportError } from "@opencrane/backend/server/infra/mcp-era-probe";
import { __CreateOciRegistryClient } from "@opencrane/backend/server/infra/oci-registry";
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
		return new McpEraProbeFailure(McpEraProbeFailureCodes.NotMcpServer);
	if (error instanceof McpEraProbeTransportError)
	{
		const status = error.code.startsWith("http_") ? Number(error.code.slice(5)) : null;
		if (error.code === "network" || error.code === "timeout" || status === 429 || (status !== null && status >= 500))
			return new McpEraProbeFailure(McpEraProbeFailureCodes.RetryableUnavailable);
		return new McpEraProbeFailure(McpEraProbeFailureCodes.NotMcpServer);
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
 * Create the guarded Absurd engine shared by remote MCP, OCI admission, and skill validation work.
 *
 * The server declares the skill-authoring task on its queue without adding a local handler. That
 * lets a product transaction admit the task while the controller remains responsible for executing
 * the Kubernetes-mutating definition. This ports-only slice does not yet wire a product schema,
 * repository adapter, route, or deployable controller registration.
 *
 * @see SkillAuthoringValidationTaskDeclaration — defines the declaration the controller shares.
 */
export function _CreateMcpWorkflowComposition(prisma: PrismaClient, config: OpenCraneWorkflowConfig): McpWorkflowComposition
{
	const queueAuthority = __CreateWorkflowTaskQueueAuthority([
		{ taskName: McpEraProbeTaskNames.Probe, queue: "control-plane" },
		{ taskName: OciImageValidationTaskNames.Import, queue: "control-plane" },
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
	const artifactReader = _CreatePublishedArtifactReader(prisma);
	const authorizationFilePath = config.ociRegistryAuthorizationFilePath;
	const readAuthorizationHeader = authorizationFilePath === undefined
		? undefined
		: async function _ReadOciRegistryAuthorization(): Promise<string> { return await readFile(authorizationFilePath, "utf8"); };
	const registry = __CreateOciRegistryClient({ baseUrl: config.ociRegistryBaseUrl, repository: config.ociRegistryRepository, requestTimeoutMilliseconds: config.ociRegistryTimeoutMilliseconds, readAuthorizationHeader });
	const verifier = __CreateOciImageLayoutVerifier(artifactReader);
	const importer = __CreateOciImageLayoutImporter(artifactReader, registry);
	const ociImageValidationWorkflow = __CreateOciImageValidationWorkflow({ execution, verifier, importer, unitOfWork });
	const artifactCatalogue = _CreateArtifactCatalogueRepository(prisma);
	const ociImageArtifacts: OciImageLayoutArtifactResolver = {
		async resolve(siloId, artifactId, artifactRevisionId)
		{
			return await artifactCatalogue.loadPublishedReadTarget({ siloId, artifactId, artifactRevisionId });
		},
	};
	return { runtime, unitOfWork, eraProbeWorkflow, ociImageValidationWorkflow, ociImageArtifacts };
}
