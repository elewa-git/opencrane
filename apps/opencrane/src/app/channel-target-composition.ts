import { createHash } from "node:crypto";

import * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";

import { PrismaChannelTargetAuthorityUnitOfWork, __CreateChannelTargetsRouter, __RandomChannelOpaqueContextSource, __SystemChannelTargetClock, type ChannelActionAuthorizationPort, type ChannelMembershipPort, type ChannelTargetResolutionDependencies, type ChannelWorkloadIdentityPort, type TrustedHostSiloPort } from "@opencrane/backend/server/agents/channel-targets";
import { PrismaFleetMembershipAuthorityRepository, __VerifyCurrentFleetMembership, _CreateFleetMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import type { ChannelTargetRouteReconciler } from "./channel-target-composition.types.js";
import type { ChannelTargetRuntimeConfig } from "./config.types.js";
import { _log } from "./log.js";

/** Internal Kubernetes DNS suffix accepted for the release-local replay receiver. */
const _INTERNAL_ROUTE_HOST_SUFFIXES = [".svc.cluster.local"] as const;

/** Delay before discovering AgentServices created after process startup. */
const _CHANNEL_ROUTE_RECONCILE_INTERVAL_MILLISECONDS = 5_000;

/** Bind Kubernetes TokenReview to the one Helm-owned channel-proxy identity. */
function _CreateChannelWorkloadIdentity(authApi: k8s.AuthenticationV1Api): ChannelWorkloadIdentityPort
{
	return {
		async review(token, audience)
		{
			return ___DoWithTrace("kubernetes.channel_proxy_token.review", {}, async function _ReviewToken()
			{
				const body = new k8s.V1TokenReview();
				body.spec = new k8s.V1TokenReviewSpec();
				body.spec.token = token;
				body.spec.audiences = [audience];
				const response = await authApi.createTokenReview({ body });
				const status = response.status;
				const username = status?.user?.username ?? "";
				const match = /^system:serviceaccount:([^:]+):([^:]+)$/u.exec(username);
				if (!status?.authenticated || !status.audiences?.includes(audience) || match === null)
				{
					return { outcome: "denied", reason: "token_review_denied" } as const;
				}
				return { outcome: "trusted", identity: { username, namespace: match[1]!, serviceAccountName: match[2]!, audiences: status.audiences } } as const;
			});
		},
	};
}

/** Resolve only the deployment's exact public host to its single silo. */
function _CreateTrustedHostSilo(config: ChannelTargetRuntimeConfig): TrustedHostSiloPort
{
	return {
		async resolveExactHost(trustedHost)
		{
			return trustedHost.toLowerCase() === config.trustedHost
				? { siloId: config.siloId, authorizationScope: { kind: "organization", organizationId: config.siloId } }
				: null;
		},
	};
}

/** Require one exact assertion from the latest signed membership revision. */
function _CreateChannelMembership(prisma: PrismaClient): ChannelMembershipPort
{
	const evidence = _CreateFleetMembershipEvidenceConfig();
	const repository = new PrismaFleetMembershipAuthorityRepository(prisma);
	return {
		async verifyCurrentMembership(subjectId, siloId, scope, nowEpochMs)
		{
			if (scope.kind !== "organization" || scope.organizationId !== siloId) return { outcome: "denied", reason: "scope_mismatch" };
			const revision = await repository.getLatestSignedRevision(evidence.trustedIssuerId, siloId);
			if (revision === null) return { outcome: "denied", reason: "missing_revision" };
			const assertions = revision.assertions.filter(assertion => assertion.siloId === siloId
				&& assertion.subjectId === subjectId
				&& assertion.scope.kind === "organization"
				&& assertion.scope.organizationId === scope.organizationId);
			if (assertions.length !== 1) return { outcome: "denied", reason: "assertion_mismatch" };
			return __VerifyCurrentFleetMembership(repository, evidence.verifier, {
				trustedIssuerId: evidence.trustedIssuerId,
				siloId,
				subjectId,
				assertionId: assertions[0]!.assertionId,
				scope,
				nowEpochMs,
				maximumStalenessMs: evidence.maximumStalenessMs,
			});
		},
	};
}

/** Authorize replay only after membership and participant checks have selected one conversation. */
function _CreateChannelAuthorization(): ChannelActionAuthorizationPort
{
	return {
		async authorize(command)
		{
			if (command.requiredActions.length !== 1 || command.requiredActions[0] !== "conversation.read") return { outcome: "denied", reason: "action_not_allowed" };
			const evidence = JSON.stringify({ action: "conversation.read", agentServiceId: command.agentServiceId, conversationId: command.conversationId, membershipRevision: command.membershipRevision, siloId: command.siloId, subjectId: command.subjectId });
			return { outcome: "allowed", authorizationDigest: `sha256:${createHash("sha256").update(evidence).digest("hex")}` };
		},
	};
}

/** Build the production channel resolver from deployment-fixed and durable authorities. */
export function _CreateChannelTargetResolver(prisma: PrismaClient, authApi: k8s.AuthenticationV1Api, config: ChannelTargetRuntimeConfig, channelProxyNamespace: string): Router
{
	const dependencies: ChannelTargetResolutionDependencies = {
		config: {
			workloadAudience: "opencrane",
			channelProxyServiceAccountName: config.channelProxyServiceAccountName,
			channelProxyNamespace,
			invocationContextTtlMs: config.invocationContextTtlMilliseconds,
			allowedRouteHostSuffixes: _INTERNAL_ROUTE_HOST_SUFFIXES,
			receiverId: config.receiverId,
			receiverEndpoint: config.receiverEndpoint,
		},
		workloadIdentity: _CreateChannelWorkloadIdentity(authApi),
		hostSilo: _CreateTrustedHostSilo(config),
		membership: _CreateChannelMembership(prisma),
		authorization: _CreateChannelAuthorization(),
		repository: new PrismaChannelTargetAuthorityUnitOfWork(prisma),
		clock: new __SystemChannelTargetClock(),
		opaqueContext: new __RandomChannelOpaqueContextSource(),
	};
	return __CreateChannelTargetsRouter(dependencies, _log);
}

/** Reconcile service-specific replay routes before either listener accepts traffic. */
export async function _ReconcileChannelTargetRoutes(prisma: PrismaClient, config: ChannelTargetRuntimeConfig | null): Promise<number>
{
	if (config === null) return 0;
	return new PrismaChannelTargetAuthorityUnitOfWork(prisma).reconcileRuntimeRoutes({ receiverId: config.receiverId, endpoint: config.receiverEndpoint, action: "events.read", allowedRouteHostSuffixes: _INTERNAL_ROUTE_HOST_SUFFIXES });
}

/** Keep deployment-owned routes converged as new AgentServices are created after startup. */
export function _StartChannelTargetRouteReconciler(prisma: PrismaClient, config: ChannelTargetRuntimeConfig | null, intervalMilliseconds = _CHANNEL_ROUTE_RECONCILE_INTERVAL_MILLISECONDS): ChannelTargetRouteReconciler
{
	if (config === null) return { async stop(): Promise<void> {} };
	let activePass: Promise<void> | null = null;
	let stopping = false;
	function _Reconcile(): void
	{
		if (stopping || activePass !== null) return;
		activePass = _ReconcileChannelTargetRoutes(prisma, config)
			.then(function _Reconciled(routeCount) { _log.debug({ routeCount }, "channel target routes reconciled"); })
			.catch(function _ReconcileFailed(error: unknown) { _log.error({ err: error }, "channel target route reconciliation failed"); })
			.finally(function _PassFinished() { activePass = null; });
	}
	const handle = setInterval(_Reconcile, intervalMilliseconds);
	handle.unref();
	return {
		async stop(): Promise<void>
		{
			stopping = true;
			clearInterval(handle);
			await activePass;
		},
	};
}
