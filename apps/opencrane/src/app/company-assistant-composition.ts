import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";

import { PROMPT_COMPILER_VERSION } from "@opencrane/contracts";
import { _CreateCompanyAssistantProvisioningRouter, PrismaCompanyAssistantProvisioningUnitOfWork } from "@opencrane/backend/server/agents/agent-services";
import { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { ConversationComputerReleaseProfileConfig } from "./config.types";
import { _log } from "./log";

/**
 * Composes the administrator's company assistant setup under the deployed computer profile.
 *
 * Called by: public route composition after browser authentication is installed.
 * The first shared assistant performs one bounded text turn per request. Its service owner rejects
 * personal memory, skills and tool assignments until those paths have their own product proof.
 * @see PrismaCompanyAssistantProvisioningUnitOfWork for current permission checks and recoverable creation.
 */
export function _CreateCompanyAssistantComposition(prisma: PrismaClient, history: HistoryStore, profile: ConversationComputerReleaseProfileConfig): Router
{
	const authority = new PrismaCompanyAssistantProvisioningUnitOfWork(prisma, {
		workloadProfile: profile.profileName,
		promptPolicyVersion: PROMPT_COMPILER_VERSION,
		budget: { maxTurns: 1, maxTokens: 32_000, maxDurationMs: 120_000 },
	}, new AgentIdentityHistory(history));
	return _CreateCompanyAssistantProvisioningRouter(authority, function _ResolveAdministrator(request)
	{
		const principal = _ResolveRequestPrincipal(request);
		return principal === null ? null : { siloId: principal.siloId, principalId: principal.principalId };
	}, _log);
}
