import { _CreateMcpEraProbeAdapter, _CreateOciImageArtifactResolver } from "@opencrane/backend/server/gateways/mcp";
import { _CreateOciRegistryAuthorizationReader } from "@opencrane/backend/server/infra/oci-registry";



import type { PrismaClient } from "@prisma/client";

import { GROUP_CHILD_TASK } from "@opencrane/backend/server/conversations";
import { _CreateArtifactCatalogueRepository } from "@opencrane/backend/server/agents/artifacts";
import { ArtifactPreprocessTaskDeclaration } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import { SkillAuthoringValidationTaskDeclaration } from "@opencrane/backend/agents/skills/workflows/contract";
import { __CreateOciImageLayoutImporter, __CreateOciImageLayoutVerifier, __CreateOciImageValidationWorkflow, __CreateMcpEraProbeWorkflow, MCP_ERA_PROTOCOL_VERSION, McpEraProbeTaskNames, McpTaskTaskNames, OciImageValidationTaskNames, PrismaMcpOperatorUnitOfWork } from "@opencrane/backend/server/gateways/mcp";

import { __CreateHttpsMcpEraProbeClient } from "@opencrane/backend/server/infra/mcp-era-probe";
import { __CreateOciRegistryClient } from "@opencrane/backend/server/infra/oci-registry";
import { _CreateAbsurdWorkflowEngine } from "@opencrane/backend/server/infra/workflows/infra_absurd";
import { __CreateWorkflowGuard, __CreateWorkflowTaskQueueAuthority } from "@opencrane/backend/server/infra/workflows/guard";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import { _CreatePublishedArtifactReader } from "@opencrane/backend/server/agents/artifacts";
import type { OpenCraneWorkflowConfig } from "../configuration/config.types";
import { _log } from "../process/log";
import type { McpWorkflowComposition } from "./mcp-workflow-composition.types";

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
 * Declares the remote PDF conversion task before a publication transaction may save it.
 *
 * The declaration makes the task name available before a publication transaction saves its
 * receipt. The server installs no handler; the controller owns the remote handler that creates
 * and releases the isolated Job.
 *
 * Called by: `_CreateMcpWorkflowComposition`.
 * @param execution - Supplies the guarded engine that owns declared task names.
 * @returns Nothing after registering the shared task declaration.
 * @see ArtifactPreprocessTaskDeclaration — fixes the task name and retry policy shared with the controller.
 */
export function __DeclareArtifactPreprocessTask(execution: Pick<IWorkflowEngine, "declare">): void
{
	execution.declare(ArtifactPreprocessTaskDeclaration);
}

/**
 * Create the guarded Absurd engine shared by remote MCP, OCI admission, skill validation, and artifact preprocessing.
 *
 * The server declares remote controller tasks without adding local handlers. Artifact publication
 * transactions save PDF-task receipts here, while the controller remains responsible for running
 * the Kubernetes-mutating definitions.
 *
 * @see SkillAuthoringValidationTaskDeclaration — defines the declaration the controller shares.
 */
export function _CreateMcpWorkflowComposition(prisma: PrismaClient, config: OpenCraneWorkflowConfig): McpWorkflowComposition
{
	const queueAuthority = __CreateWorkflowTaskQueueAuthority([
		{ taskName: GROUP_CHILD_TASK.taskName, queue: "control-plane" },
		{ taskName: McpEraProbeTaskNames.Probe, queue: "control-plane" },
		{ taskName: OciImageValidationTaskNames.Import, queue: "control-plane" },
		{ taskName: McpTaskTaskNames.Call, queue: "control-plane" },
		{ taskName: SkillAuthoringValidationTaskDeclaration.taskName, queue: "skill-authoring" },
		{ taskName: ArtifactPreprocessTaskDeclaration.taskName, queue: "artifact-preprocessing" },
	]);
	const runtime = _CreateAbsurdWorkflowEngine({ databasePoolSize: config.databasePoolSize, databaseUrl: config.databaseUrl, log: _log, pollIntervalMs: config.pollIntervalMilliseconds, queueAuthority, workerConcurrency: config.workerConcurrency });
	const execution = __CreateWorkflowGuard({ execution: runtime, log: _log, queueAuthority, siloId: config.siloId });
	__DeclareSkillAuthoringValidation(execution);
	__DeclareArtifactPreprocessTask(execution);
	const transport = __CreateHttpsMcpEraProbeClient({ protocolVersion: MCP_ERA_PROTOCOL_VERSION, maximumResponseBytes: config.mcpEraProbeMaximumResponseBytes, requestTimeoutMilliseconds: config.mcpEraProbeTimeoutMilliseconds });
	const probe = _CreateMcpEraProbeAdapter(transport);
	const unitOfWork = new PrismaMcpOperatorUnitOfWork(prisma);
	const eraProbeWorkflow = __CreateMcpEraProbeWorkflow({ execution, probe, unitOfWork });
	const artifactReader = _CreatePublishedArtifactReader(prisma);
	const readAuthorizationHeader = _CreateOciRegistryAuthorizationReader(config.ociRegistryAuthorizationFilePath);
	const registry = __CreateOciRegistryClient({ baseUrl: config.ociRegistryBaseUrl, repository: config.ociRegistryRepository, requestTimeoutMilliseconds: config.ociRegistryTimeoutMilliseconds, readAuthorizationHeader });
	const verifier = __CreateOciImageLayoutVerifier(artifactReader);
	const importer = __CreateOciImageLayoutImporter(artifactReader, registry);
	const ociImageValidationWorkflow = __CreateOciImageValidationWorkflow({ execution, verifier, importer, unitOfWork });
	const artifactCatalogue = _CreateArtifactCatalogueRepository(prisma);
	const ociImageArtifacts = _CreateOciImageArtifactResolver(artifactCatalogue);
	return { execution, runtime, unitOfWork, eraProbeWorkflow, ociImageValidationWorkflow, ociImageArtifacts };
}
