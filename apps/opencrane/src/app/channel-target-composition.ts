import type { AuthenticationV1Api } from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";

import { PrismaChannelTargetAuthorityUnitOfWork, __CreateChannelTargetsRouter, __ExactHostSiloResolver, __RandomChannelOpaqueContextSource, __ReconcileChannelTargetRoutes as __ReconcileOwnedChannelTargetRoutes, __StartChannelTargetRouteReconciler as __StartOwnedChannelTargetRouteReconciler, __SystemChannelTargetClock, type ChannelTargetResolutionConfig, type ChannelTargetResolutionDependencies, type ChannelTargetRouteReconciler, type ChannelTargetRouteReconcilerDependencies, type ReconcileChannelRuntimeRoutesCommand } from "@opencrane/backend/server/agents/channel-targets";
import { PrismaFleetMembershipAuthorityRepository, SignedFleetMembershipAssertionVerifier, _CreateFleetMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import { _CreateChannelProxyTokenReviewer } from "@opencrane/backend/server/infra/workload-identity";

import type { ChannelTargetRuntimeConfig } from "./config.types.js";
import { _log } from "./log.js";

/** Internal Kubernetes DNS suffix accepted for the release-local replay receiver. */
const _INTERNAL_ROUTE_HOST_SUFFIXES = [".svc.cluster.local"] as const;

/** Delay before discovering AgentServices created after process startup. */
const _CHANNEL_ROUTE_RECONCILE_INTERVAL_MILLISECONDS = 5_000;

/** Build the resolver's fixed policy from the validated deployment configuration. */
function _CreateResolutionConfig(config: ChannelTargetRuntimeConfig, channelProxyNamespace: string): ChannelTargetResolutionConfig
{
	return {
		workloadAudience: "opencrane",
		channelProxyServiceAccountName: config.channelProxyServiceAccountName,
		channelProxyNamespace,
		invocationContextTtlMs: config.invocationContextTtlMilliseconds,
		allowedRouteHostSuffixes: _INTERNAL_ROUTE_HOST_SUFFIXES,
		receiverId: config.receiverId,
		receiverEndpoint: config.receiverEndpoint,
	};
}

/** Wire up the resolver's adapters here; each adapter's trust logic stays in the package that owns it. */
function _CreateResolutionDependencies(prisma: PrismaClient, authApi: AuthenticationV1Api, config: ChannelTargetRuntimeConfig, channelProxyNamespace: string): ChannelTargetResolutionDependencies
{
	const resolutionConfig = _CreateResolutionConfig(config, channelProxyNamespace);
	return {
		config: resolutionConfig,
		workloadIdentity: _CreateChannelProxyTokenReviewer(authApi, { audience: resolutionConfig.workloadAudience, namespace: resolutionConfig.channelProxyNamespace, serviceAccountName: resolutionConfig.channelProxyServiceAccountName }),
		hostSilo: new __ExactHostSiloResolver({ trustedHost: config.trustedHost, siloId: config.siloId }),
		membership: new SignedFleetMembershipAssertionVerifier(new PrismaFleetMembershipAuthorityRepository(prisma), _CreateFleetMembershipEvidenceConfig()),
		repository: new PrismaChannelTargetAuthorityUnitOfWork(prisma),
		clock: new __SystemChannelTargetClock(),
		opaqueContext: new __RandomChannelOpaqueContextSource(),
	};
}

/** Build the route-reconcile command from the deployment config, or return null to turn reconciling off. */
function _CreateRouteCommand(config: ChannelTargetRuntimeConfig | null): ReconcileChannelRuntimeRoutesCommand | null
{
	if (config === null) return null;
	return { receiverId: config.receiverId, endpoint: config.receiverEndpoint, action: "events.read", allowedRouteHostSuffixes: _INTERNAL_ROUTE_HOST_SUFFIXES };
}

/** Build the dependencies the route reconciler needs: this app's logger and its Prisma persistence. */
function _CreateRouteReconcilerDependencies(prisma: PrismaClient, config: ChannelTargetRuntimeConfig | null, intervalMilliseconds: number): ChannelTargetRouteReconcilerDependencies
{
	return { repository: new PrismaChannelTargetAuthorityUnitOfWork(prisma), command: _CreateRouteCommand(config), logger: _log, intervalMilliseconds };
}

/** Build the channel-resolver router from the deployment config and the database. */
export function _CreateChannelTargetResolver(prisma: PrismaClient, authApi: AuthenticationV1Api, config: ChannelTargetRuntimeConfig, channelProxyNamespace: string): Router
{
	return __CreateChannelTargetsRouter(_CreateResolutionDependencies(prisma, authApi, config, channelProxyNamespace), _log);
}

/** Reconcile one replay route per AgentService before either listener accepts traffic. */
export async function _ReconcileChannelTargetRoutes(prisma: PrismaClient, config: ChannelTargetRuntimeConfig | null): Promise<number>
{
	return __ReconcileOwnedChannelTargetRoutes(_CreateRouteReconcilerDependencies(prisma, config, _CHANNEL_ROUTE_RECONCILE_INTERVAL_MILLISECONDS));
}

/** Start the worker that keeps the replay routes reconciled. */
export function _StartChannelTargetRouteReconciler(prisma: PrismaClient, config: ChannelTargetRuntimeConfig | null, intervalMilliseconds = _CHANNEL_ROUTE_RECONCILE_INTERVAL_MILLISECONDS): ChannelTargetRouteReconciler
{
	return __StartOwnedChannelTargetRouteReconciler(_CreateRouteReconcilerDependencies(prisma, config, intervalMilliseconds));
}
