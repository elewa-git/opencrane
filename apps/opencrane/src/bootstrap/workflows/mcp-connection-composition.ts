import type { PrismaClient } from "@prisma/client";

import { PrismaManagedExecutionEvidenceRepository } from "@opencrane/backend/server/agents/agent-services";
import { __CreateMcpConnectionWorkflowAdmission, __McpConnectionAuthority, __McpConnectionCredentialReader, __McpConnectionWorkflowController, __RegisterMcpConnectionWorkflow, KubernetesMcpConnectionSecretStore, _CreateFileBackedMcpConnectionMaterialVerifier, PrismaMcpConnectionAdmissionUnitOfWork, PrismaMcpRemoteRevisionFinalizerUnitOfWork, StandardMcpAuthenticatedConnectionDiscovery } from "@opencrane/backend/server/gateways/mcp";
import { _CreateHumanMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";

import { _log } from "../process/log";

import type { McpConnectionComposition, McpConnectionCompositionDependencies } from "./mcp-connection-composition.types";

/** Connects MCP-owned credential custody and discovery to the server's existing workflow engine. */
export function _CreateMcpConnectionComposition(prisma: PrismaClient, dependencies: McpConnectionCompositionDependencies): McpConnectionComposition
{
	const { coreApi, config, workflows, settlement } = dependencies;
	const verifier = _CreateFileBackedMcpConnectionMaterialVerifier(config.materialKeyringPath);
	const secrets = new KubernetesMcpConnectionSecretStore(coreApi, config.credentialNamespace, verifier, _log);
	const admission = __CreateMcpConnectionWorkflowAdmission(workflows.execution);
	const membership = _CreateHumanMembershipEvidenceConfig();
	const unitOfWork = new PrismaMcpConnectionAdmissionUnitOfWork(prisma, admission, {
		create(transaction)
		{
			const services = new PrismaManagedExecutionEvidenceRepository(transaction, membership);
			return {
				async resolve(siloId, agentServiceId)
				{
					const evidence = await services.loadCurrent(siloId, agentServiceId);
					return evidence === null ? null : { agentServiceId: evidence.agentServiceId, principalId: evidence.principalId };
				},
			};
		},
	});
	const finalizer = new PrismaMcpRemoteRevisionFinalizerUnitOfWork(prisma);
	const discovery = new StandardMcpAuthenticatedConnectionDiscovery(workflows.remoteClient, finalizer);
	const controller = new __McpConnectionWorkflowController(unitOfWork, secrets, discovery, settlement);
	__RegisterMcpConnectionWorkflow(workflows.execution, controller);
	return { authority: new __McpConnectionAuthority(unitOfWork, secrets, verifier), credentials: new __McpConnectionCredentialReader(unitOfWork, secrets) };
}
