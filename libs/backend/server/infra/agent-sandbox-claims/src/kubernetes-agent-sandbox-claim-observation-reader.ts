import { _IsK8sNotFound } from "@opencrane/backend/server/infra/api";

import { __AgentSandboxClaimName } from "./kubernetes-agent-sandbox-claim-authority";
import { AgentSandboxClaimObservationStates, type AgentSandboxClaimCustomObjectsApi, type AgentSandboxClaimObservation, type AgentSandboxClaimObservationCommand, type AgentSandboxClaimObservationReader } from "./agent-sandbox-claims.types";

const _AGENT_SANDBOX_API_GROUP = "extensions.agents.x-k8s.io";
const _AGENT_SANDBOX_API_VERSION = "v1beta1";
const _AGENT_SANDBOX_CLAIM_PLURAL = "sandboxclaims";
const _DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const _KUBERNETES_CONDITION_TRUE = "True";

/**
 * Reads one immutable Agent Sandbox claim and exposes only its current ready assignment.
 *
 * A missing, unready, or stale status remains pending. The caller retains lease-expiry decisions;
 * this adapter refuses malformed or foreign resources instead of adopting their sandbox status.
 */
export class _KubernetesAgentSandboxClaimObservationReader implements AgentSandboxClaimObservationReader
{
	/** Connects this read-only adapter to the server identity's namespaced custom-object client. */
	public constructor(private readonly customApi: AgentSandboxClaimCustomObjectsApi) {}

/**
 * Reads and validates the exact deterministic claim before returning its ready sandbox id.
 *
 * @param command - Supplies the immutable coordinates previously derived from checked history.
 * @returns `Pending` for a missing, unready, or stale claim, or `Ready` with its current sandbox id.
 * @throws {Error} Propagates Kubernetes failure and rejects a found claim with mismatched fields.
 */
	public async observe(command: AgentSandboxClaimObservationCommand): Promise<AgentSandboxClaimObservation>
	{
		const claimName = __AgentSandboxClaimName(command.computerId, command.generation);
		let claim: unknown;
		try
		{
			claim = await this.customApi.getNamespacedCustomObject({
				group: _AGENT_SANDBOX_API_GROUP,
				version: _AGENT_SANDBOX_API_VERSION,
				namespace: command.namespace,
				plural: _AGENT_SANDBOX_CLAIM_PLURAL,
				name: claimName,
			});
		}
		catch (error)
		{
			if (_IsK8sNotFound(error))
				return { state: AgentSandboxClaimObservationStates.Pending };
			throw error;
		}
		return _ReadObservation(claim, command, claimName);
	}
}

/** Verifies claim identity and returns ready only from one observed, current SandboxClaim assignment. */
function _ReadObservation(value: unknown, command: AgentSandboxClaimObservationCommand, claimName: string): AgentSandboxClaimObservation
{
	if (!_IsRecord(value) || value.apiVersion !== `${_AGENT_SANDBOX_API_GROUP}/${_AGENT_SANDBOX_API_VERSION}` || value.kind !== "SandboxClaim")
		throw new Error(`Agent Sandbox claim '${claimName}' has an unexpected resource identity`);
	const metadata = value.metadata;
	const spec = value.spec;
	if (!_IsRecord(metadata) || !_IsRecord(spec) || metadata.name !== claimName || metadata.namespace !== command.namespace || !_MatchesExpectedRecord(metadata.labels, {
		"opencrane.ai/silo-id": command.siloId,
		"opencrane.ai/computer-id": command.computerId,
		"opencrane.ai/computer-generation": String(command.generation),
		"opencrane.ai/profile": command.profile,
	}) || !_MatchesExpectedRecord(metadata.annotations, { "opencrane.ai/lease-reason": command.reason }) || !_MatchesExpectedRecord(spec.warmPoolRef, { name: command.warmPoolName }) || !_MatchesExpectedRecord(spec.lifecycle, { shutdownPolicy: "DeleteForeground", shutdownTime: command.shutdownTime.toISOString() }))
		throw new Error(`Agent Sandbox claim '${claimName}' conflicts with the expected immutable lease`);
	const status = value.status;
	if (!_IsRecord(status) || !_IsRecord(status.sandbox) || !_IsDnsLabel(status.sandbox.name))
		return { state: AgentSandboxClaimObservationStates.Pending };
	const generation = metadata.generation;
	if (typeof generation !== "number" || !Number.isSafeInteger(generation) || generation < 1 || !Array.isArray(status.conditions))
		return { state: AgentSandboxClaimObservationStates.Pending };
	const ready = status.conditions.filter(_IsReadyCondition);
	if (ready.length !== 1 || ready[0].observedGeneration !== generation)
		return { state: AgentSandboxClaimObservationStates.Pending };
	return { state: AgentSandboxClaimObservationStates.Ready, sandboxId: status.sandbox.name };
}

/** Recognizes the exact current Ready=True condition shape before status can activate a lease. */
function _IsReadyCondition(value: unknown): value is { readonly observedGeneration: number }
{
	return _IsRecord(value) && value.type === "Ready" && value.status === _KUBERNETES_CONDITION_TRUE && Number.isSafeInteger(value.observedGeneration);
}

/** Checks an immutable nested Kubernetes record without permitting a controller-added lease field. */
function _MatchesExpectedRecord(value: unknown, expected: Record<string, string>): boolean
{
	return _IsRecord(value) && Object.keys(value).length === Object.keys(expected).length && Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue);
}

/** Narrows untrusted Kubernetes data without accepting arrays as resource records. */
function _IsRecord(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Checks the Sandbox name form that the Kubernetes status may bind to a computer lease. */
function _IsDnsLabel(value: unknown): value is string
{
	return typeof value === "string" && value.length <= 63 && _DNS_LABEL.test(value);
}
