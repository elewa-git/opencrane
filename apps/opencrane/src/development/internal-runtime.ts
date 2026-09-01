import { randomBytes } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { PrismaRuntimeContinuationAuthorityUnitOfWork, RuntimeExternalActionAuthorizationService, __CreateProductionRuntimeDispatchAuthority, type RuntimeExternalActionEligibilityFactory } from "@opencrane/backend/agents/execution/protocol";
import { PrismaRuntimePersonalMemoryEffectEligibilityAuthority } from "@opencrane/backend/agents/personal/memory";
import { PrismaRuntimePersonaEffectEligibilityAuthority } from "@opencrane/backend/agents/personal/personas";
import { PrismaAgentRunWarmRuntimeUnitOfWork, PrismaWarmRuntimeBindingUnitOfWork, __CreateAgentRunWorkflowControllerRouter, __CreateWarmRuntimeBindingRouter, type AttemptModelKeyIssuerWithRevocation, type AttemptModelKeyMintRequest, type MintedAttemptModelKey } from "@opencrane/backend/agents/execution/runs";
import { PrismaRuntimeAgentEffectEligibilityAuthority } from "@opencrane/backend/server/agents/agent-services";
import { PrismaRuntimeMcpEffectEligibilityAuthority } from "@opencrane/backend/server/gateways/mcp";
import { _IssueAttemptLiteLlmKey, _RevokeAttemptLiteLlmKey } from "@opencrane/backend/server/gateways/model-routing";
import { PrismaRuntimeMembershipEligibilityAuthority, type FleetMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import { PrismaAgentThreadParentDeliveryUnitOfWork, __CreateAgentThreadParentDeliveryRouter } from "@opencrane/backend/server/conversations";
import { MountedRuntimeContinuationCipher } from "@opencrane/backend/server/infra/agent-runtime-continuation";
import { _RegisterInternalAgentRuntimeStream } from "@opencrane/backend/server/infra/agent-runtime-stream";
import type { FixedServiceAccountTokenReviewer, RuntimeIdentityNamespaces, RuntimeTokenReviewer } from "@opencrane/backend/server/infra/workload-identity";
import { LocalDevelopmentProfileKinds } from "@opencrane/models/local-development";

import { _log } from "../app/log";
import type { DevelopmentInternalRuntimeComposition } from "./internal-runtime.types";
import type { DevelopmentRuntimeConfig } from "./runtime-config.types";

/** Create an attempt-scoped model key without exposing the LiteLLM master key to the controller. */
function _CreateDevelopmentAttemptModelKeyIssuer(profile: LocalDevelopmentProfileKinds): AttemptModelKeyIssuerWithRevocation
{
	if (profile === LocalDevelopmentProfileKinds.AgentSimulated)
	{
		return Object.assign(
			async function _IssueSimulatedAttemptModelKey(_request: AttemptModelKeyMintRequest): Promise<MintedAttemptModelKey>
			{
				return { key: randomBytes(32).toString("base64url") };
			},
			{ async revokeAttemptKey(): Promise<void> {} },
		);
	}

	return Object.assign(
		async function _IssueDevelopmentAttemptModelKey(request: AttemptModelKeyMintRequest): Promise<MintedAttemptModelKey>
		{
			const minted = await _IssueAttemptLiteLlmKey({ keyAlias: request.keyAlias, modelAlias: request.modelAlias, maxBudgetUsd: request.maxBudgetUsd, expirySeconds: request.expirySeconds });
			return { key: minted.key };
		},
		{
			async revokeAttemptKey(request: { readonly keyAlias: string; readonly key: string }): Promise<void>
			{
				await _RevokeAttemptLiteLlmKey(request);
			},
		},
	);
}

/**
 * Composes the authenticated controller and warm-runtime routes shared by Agent Alternatives A, B,
 * and C.
 *
 * Runtime external actions re-check membership inside their transaction. The caller passes the
 * evidence configuration used during run admission so that re-check cannot select a different
 * issuer, verification key, or staleness limit from ambient process state.
 *
 * Called by: `_CreateDevelopmentInternalApp` after it validates the controller and runtime identities.
 * @param prisma - Database client used by the production runtime authorities.
 * @param config - Runtime command and assignment lifetimes.
 * @param namespaces - Separate server, personal-runtime, and managed-runtime namespaces.
 * @param profile - Agent profile that selects simulated or LiteLLM model keys.
 * @param controllerTokenReviewer - Reviewer for controller requests.
 * @param runtimeTokenReviewer - Reviewer for warm-runtime requests.
 * @param continuationKeyringPath - File containing the runtime continuation keyring.
 * @param membershipEvidence - Evidence configuration already used for run admission.
 * @returns Routers for controller assignment, runtime binding and streaming, and parent delivery.
 */
export function _CreateDevelopmentInternalRuntimeComposition(prisma: PrismaClient, config: DevelopmentRuntimeConfig, namespaces: RuntimeIdentityNamespaces, profile: LocalDevelopmentProfileKinds, controllerTokenReviewer: FixedServiceAccountTokenReviewer, runtimeTokenReviewer: RuntimeTokenReviewer, continuationKeyringPath: string, membershipEvidence: FleetMembershipEvidenceConfig): DevelopmentInternalRuntimeComposition
{
	const issueAttemptModelKey = _CreateDevelopmentAttemptModelKeyIssuer(profile);
	const continuationAuthority = new PrismaRuntimeContinuationAuthorityUnitOfWork(prisma, {
		personalRuntimeNamespace: namespaces.personalRuntimeNamespace,
		managedRuntimeNamespace: namespaces.managedRuntimeNamespace,
		commandTtlMilliseconds: config.commandTtlMilliseconds,
	}, new MountedRuntimeContinuationCipher(continuationKeyringPath), _log);
	const warmAuthority = new PrismaAgentRunWarmRuntimeUnitOfWork(prisma, {
		personalRuntimeNamespace: namespaces.personalRuntimeNamespace,
		managedRuntimeNamespace: namespaces.managedRuntimeNamespace,
		assignmentTtlMilliseconds: config.assignmentTtlMilliseconds,
		issueAttemptModelKey,
		continuationRecovery: continuationAuthority,
	});
	const eligibility: RuntimeExternalActionEligibilityFactory = {
		bind(transaction)
		{
			return {
				agentService: new PrismaRuntimeAgentEffectEligibilityAuthority(transaction),
				membership: new PrismaRuntimeMembershipEligibilityAuthority(transaction, membershipEvidence),
				mcp: new PrismaRuntimeMcpEffectEligibilityAuthority(transaction),
				personalMemory: new PrismaRuntimePersonalMemoryEffectEligibilityAuthority(transaction),
				persona: new PrismaRuntimePersonaEffectEligibilityAuthority(transaction),
			};
		},
	};
	const runtimeDispatchAuthority = __CreateProductionRuntimeDispatchAuthority(prisma, {
		personalRuntimeNamespace: namespaces.personalRuntimeNamespace,
		managedRuntimeNamespace: namespaces.managedRuntimeNamespace,
		commandTtlMilliseconds: config.commandTtlMilliseconds,
	}, continuationAuthority, new RuntimeExternalActionAuthorizationService(eligibility));

	return {
		agentRunWorkflowController: __CreateAgentRunWorkflowControllerRouter({ tokenReviewer: controllerTokenReviewer, namespace: namespaces.serverNamespace, warmAuthority, logger: _log }),
		warmRuntimeBinding: __CreateWarmRuntimeBindingRouter({ tokenReviewer: runtimeTokenReviewer, authority: new PrismaWarmRuntimeBindingUnitOfWork(prisma, { assignmentTtlMilliseconds: config.assignmentTtlMilliseconds, issueAttemptModelKey }), logger: _log }),
		warmRuntimeStream: _RegisterInternalAgentRuntimeStream({
			tokenReviewer: runtimeTokenReviewer,
			authority: runtimeDispatchAuthority,
			maxBodyBytes: 64 * 1_024,
			heartbeatMilliseconds: 15_000,
			commandRecoveryMilliseconds: config.commandRecoveryMilliseconds,
		}),
		agentThreadParentDeliveries: __CreateAgentThreadParentDeliveryRouter({ tokenReviewer: runtimeTokenReviewer, authority: new PrismaAgentThreadParentDeliveryUnitOfWork(prisma, _log), logger: _log }),
	};
}
