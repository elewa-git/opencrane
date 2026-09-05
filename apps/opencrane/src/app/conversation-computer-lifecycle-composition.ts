import { Readable } from "node:stream";

import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import { ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";
import { ConversationComputerCheckpointAuthority, ConversationComputerHistory, ConversationComputerLifecycleAuthority, ConversationComputerLifecycleScheduler, PrismaConversationComputerLifecycleProjectionRepository, _CreateConversationComputerCheckpointRouter, type ConversationComputerCheckpointSandbox, type ConversationComputerLifecycleCandidate } from "@opencrane/backend/server/conversations";
import { AgentSandboxClaimAdapter, AgentSandboxPodBindingAdapter } from "@opencrane/backend/server/infra/agent-sandbox";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { _CreateConversationComputerTokenReviewer } from "@opencrane/backend/server/infra/workload-identity";

import type { AgentSandboxReleaseProfileConfig } from "./config.types";
import type { ConversationComputerActivationWorker } from "./conversation-computer-activation-composition.types";
import { _log } from "./log";
import { _CreateArtifactUploadGateway, _CreatePublishedArtifactReader } from "../infra/artifacts/artifact-upload.factory";

/** Fixed lifecycle timings and archive ceiling admitted by release 0.11. */
const _POLICY = { staleAfterMilliseconds: 300_000, retireAfterMilliseconds: 1_200_000 };
const _CHECKPOINT_POLICY = { format: "opencrane-workspace-tar-v1", maximumBytes: 64 * 1024 * 1024, uploadLeaseSeconds: 300 };

/** Compose checkpoint transport, exact Pod fencing, restore route, and bounded lifecycle scheduler. */
export function _CreateConversationComputerLifecycleComposition(prisma: PrismaClient, historyStore: HistoryStore, authApi: k8s.AuthenticationV1Api, coreApi: k8s.CoreV1Api, customApi: k8s.CustomObjectsApi, profile: AgentSandboxReleaseProfileConfig, workflow: Parameters<typeof _CreateArtifactUploadGateway>[1]): { readonly router: import("express").Router; readonly worker: ConversationComputerActivationWorker }
{
	const history = new ConversationComputerHistory(historyStore);
	const projections = new PrismaConversationComputerLifecycleProjectionRepository(prisma);
	const pods = new AgentSandboxPodBindingAdapter(coreApi, customApi);
	const sandbox = _SandboxTransport();
	const fence = { async assertCurrent(command: Parameters<ConversationComputerCheckpointAuthority["restore"]>[0])
	{
		const coordinates = await projections.resolve(command.siloId, command.computerId);
		if (coordinates === null)
			throw new Error("Conversation computer checkpoint projection is unavailable");
		const current = await history.load(coordinates);
		if (current === null || current.lease === null || current.lease.state !== ComputerLeaseStates.Active || current.lease.id !== command.leaseId || current.lease.generation !== command.generation || current.lease.sandboxId === null)
			throw new Error("Conversation computer checkpoint requires the current lease generation");
		const workload = { namespace: profile.namespace, serviceAccountName: profile.serviceAccountName, podUid: command.podUid, subject: `system:serviceaccount:${profile.namespace}:${profile.serviceAccountName}` };
		if (!await pods.verify({ computerId: command.computerId, generation: command.generation, leaseId: command.leaseId, sandboxClaimId: current.lease.sandboxClaimId, workload }))
			throw new Error("Conversation computer checkpoint Pod is not lease-bound");
		return { computer: current.computer, lease: current.lease };
	} };
	const checkpoints = new ConversationComputerCheckpointAuthority(sandbox, projections, _CreateArtifactUploadGateway(prisma, workflow), _CreatePublishedArtifactReader(prisma), fence, _CHECKPOINT_POLICY);
	const authority = new ConversationComputerLifecycleAuthority(history, checkpoints, projections, new AgentSandboxClaimAdapter(customApi), profile.namespace, _POLICY);
	const enumerator = { async enumerateDue(now: Date, limit: number): Promise<readonly ConversationComputerLifecycleCandidate[]>
	{
		const coordinates = await projections.enumerate(profile.namespace, limit);
		const candidates: ConversationComputerLifecycleCandidate[] = [];
		for (const coordinate of coordinates)
		{
			const current = await history.load(coordinate);
			if (current === null || current.computer.state === ConversationComputerStates.Cold || current.computer.state === ConversationComputerStates.RecoveryRequired || current.computer.state === ConversationComputerStates.Retired)
				continue;
			const delay = current.computer.state === ConversationComputerStates.Warm ? _POLICY.staleAfterMilliseconds : _POLICY.retireAfterMilliseconds;
			const deadline = new Date(Date.parse(current.computer.updatedAt) + delay);
			if (deadline <= now)
				candidates.push({ ...coordinate, state: current.computer.state, deadline });
		}
		return candidates;
	} };
	const scheduler = new ConversationComputerLifecycleScheduler(enumerator, authority, 50);
	const timer = setInterval(function _ReconcileComputers() { void scheduler.reconcileDue(new Date()).catch(function _LogFailure(error: unknown) { _log.error({ err: error }, "conversation computer lifecycle pass failed"); }); }, 30_000);
	timer.unref();
	return { router: _CreateConversationComputerCheckpointRouter({ authority: checkpoints, siloId: profile.namespace, tokenReviewer: _CreateConversationComputerTokenReviewer(authApi, profile.namespace, profile.serviceAccountName) }), worker: { stop: async function _Stop(): Promise<void> { clearInterval(timer); } } };
}

/** Build the server-owned HTTP transport to the current lease-local checkpoint endpoints. */
function _SandboxTransport(): ConversationComputerCheckpointSandbox
{
	return {
		async capture(_computer, lease)
		{
			const response = await fetch(_SandboxUrl(lease.serviceFQDN, "/v1/checkpoints/capture"), { headers: { authorization: `Bearer ${lease.id}` }, signal: AbortSignal.timeout(30_000) });
			if (!response.ok || response.body === null || response.headers.get("content-type") !== "application/vnd.opencrane.workspace-tar+gzip")
				throw new Error(`Conversation computer checkpoint capture failed with ${response.status}`);
			return _WebBytes(response.body);
		},
		async restore(_computer, lease, bytes): Promise<void>
		{
			const response = await fetch(_SandboxUrl(lease.serviceFQDN, "/v1/checkpoints/restore"), { method: "POST", headers: { authorization: `Bearer ${lease.id}`, "content-type": "application/vnd.opencrane.workspace-tar+gzip" }, body: Readable.toWeb(Readable.from(bytes)) as unknown as BodyInit, duplex: "half", signal: AbortSignal.timeout(30_000) } as RequestInit);
			if (!response.ok)
				throw new Error(`Conversation computer checkpoint restore failed with ${response.status}`);
		},
	};
}

/** Restrict checkpoint traffic to the authoritative cluster-local sandbox Service. */
function _SandboxUrl(serviceFQDN: string | null, path: string): string
{
	if (serviceFQDN === null || !/^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/.test(serviceFQDN))
		throw new Error("Conversation computer checkpoint requires a valid sandbox Service FQDN");
	return `http://${serviceFQDN}:8090${path}`;
}

/** Adapt one fetch body to the artifact upload streaming contract. */
async function* _WebBytes(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array>
{
	for await (const chunk of Readable.fromWeb(body as never))
		yield chunk;
}
