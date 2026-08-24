import { randomBytes } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { __CreateProductionRuntimeDispatchAuthority } from "@opencrane/backend/agents/execution/protocol";
import { PrismaRunDispatchRepository, __CreateAgentControllerRunDispatchRouter, type AttemptModelKeyMintRequest, type MintedAttemptModelKey } from "@opencrane/backend/agents/execution/runs";
import { _IssueAttemptLiteLlmKey } from "@opencrane/backend/server/gateways/model-routing";
import { PrismaAgentThreadParentDeliveryUnitOfWork, __CreateAgentThreadParentDeliveryRouter } from "@opencrane/backend/server/conversations";
import { _RegisterInternalAgentRuntimeStream } from "@opencrane/backend/server/infra/agent-runtime-stream";
import type { FixedServiceAccountTokenReviewer, RuntimeIdentityNamespaces, RuntimeTokenReviewer } from "@opencrane/backend/server/infra/workload-identity";
import { PrismaRuntimeBootstrapExchange, __CreateRuntimeBootstrapRouter } from "@opencrane/backend/server/iam/authorization";
import { LocalDevelopmentProfileKinds } from "@opencrane/models/local-development";

import { _log } from "../app/log";
import type { DevelopmentInternalRuntimeComposition } from "./internal-runtime.types";
import type { DevelopmentRuntimeConfig } from "./runtime-config.types";

/** Mint a real LiteLLM key for A/B and a credential-free placeholder for simulated model output. */
async function _IssueDevelopmentAttemptModelKey(profile: LocalDevelopmentProfileKinds, request: AttemptModelKeyMintRequest): Promise<MintedAttemptModelKey>
{
	if (profile === LocalDevelopmentProfileKinds.AgentSimulated)
	{
		return { key: randomBytes(32).toString("base64url") };
	}

	const minted = await _IssueAttemptLiteLlmKey({
		keyAlias: request.keyAlias,
		modelAlias: request.modelAlias,
		maxBudgetUsd: request.maxBudgetUsd,
		expirySeconds: request.expirySeconds
	});
	return { key: minted.key };
}

/** Compose the authenticated controller and runtime routes shared by Agent Alternatives A, B, and C. */
export function _CreateDevelopmentInternalRuntimeComposition(prisma: PrismaClient, config: DevelopmentRuntimeConfig, namespaces: RuntimeIdentityNamespaces, profile: LocalDevelopmentProfileKinds, controllerTokenReviewer: FixedServiceAccountTokenReviewer, runtimeTokenReviewer: RuntimeTokenReviewer): DevelopmentInternalRuntimeComposition
{
	// 1. Reuse run claim and assignment persistence while selecting the profile's model-key boundary.
	const runDispatchRepository = new PrismaRunDispatchRepository(prisma, {
		personalRuntimeNamespace: namespaces.personalRuntimeNamespace,
		managedRuntimeNamespace: namespaces.managedRuntimeNamespace,
		claimLeaseMilliseconds: config.claimLeaseMilliseconds,
		assignmentTtlMilliseconds: config.assignmentTtlMilliseconds,
		publishedOutboxRetentionMilliseconds: config.publishedOutboxRetentionMilliseconds,
		outboxPruneBatchSize: config.outboxPruneBatchSize
	}, function _IssueModelKey(request): Promise<MintedAttemptModelKey>
	{
		return _IssueDevelopmentAttemptModelKey(profile, request);
	});

	// 2. Reuse bootstrap and dispatch authorities so simulated output has the same admission path.
	const runtimeDispatchAuthority = __CreateProductionRuntimeDispatchAuthority(prisma, {
		personalRuntimeNamespace: namespaces.personalRuntimeNamespace,
		managedRuntimeNamespace: namespaces.managedRuntimeNamespace,
		commandTtlMilliseconds: config.commandTtlMilliseconds
	});

	// 3. Mount no skill, artifact, channel, or Kubernetes routes in the local Agent composition.
	return {
		agentControllerRunDispatch: __CreateAgentControllerRunDispatchRouter({
			tokenReviewer: controllerTokenReviewer,
			namespace: namespaces.serverNamespace,
			repository: runDispatchRepository,
			logger: _log
		}),
		runtimeBootstrap: __CreateRuntimeBootstrapRouter({
			tokenReviewer: runtimeTokenReviewer,
			runtimeNamespaces: [namespaces.personalRuntimeNamespace, namespaces.managedRuntimeNamespace],
			repository: new PrismaRuntimeBootstrapExchange(prisma),
			clock: { nowEpochMs: function _nowEpochMs() { return Date.now(); } },
			logger: _log
		}),
		runtimeStream: _RegisterInternalAgentRuntimeStream({
			tokenReviewer: runtimeTokenReviewer,
			authority: runtimeDispatchAuthority,
			maxBodyBytes: 64 * 1_024,
			heartbeatMilliseconds: 15_000,
			commandRecoveryMilliseconds: config.commandRecoveryMilliseconds
		}),
		agentThreadParentDeliveries: __CreateAgentThreadParentDeliveryRouter({
			tokenReviewer: runtimeTokenReviewer,
			authority: new PrismaAgentThreadParentDeliveryUnitOfWork(prisma, _log),
			logger: _log
		})
	};
}
