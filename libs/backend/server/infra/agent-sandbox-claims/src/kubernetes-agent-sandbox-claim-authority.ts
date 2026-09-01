import { ___DoWithTrace } from "@opencrane/backend/observability";
import { _IsK8sConflict } from "@opencrane/backend/server/infra/api";

import { AgentSandboxClaimReason, type AgentSandboxClaimAuthority, type AgentSandboxClaimCommand, type AgentSandboxClaimCustomObjectsApi, type AgentSandboxClaimReceipt } from "./agent-sandbox-claims.types";

const _AGENT_SANDBOX_API_GROUP = "extensions.agents.x-k8s.io";
const _AGENT_SANDBOX_API_VERSION = "v1beta1";
const _AGENT_SANDBOX_CLAIM_PLURAL = "sandboxclaims";
const _DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const _COMPUTER_ID = /^computer-[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/**
 * Adapts a release-scoped Kubernetes client to deterministic Agent Sandbox claims.
 *
 * A conflict triggers one name-based read because the plan requires duplicate activation attempts
 * and controller restarts to converge on the admitted generation. The adapter rejects a different
 * resource rather than adopting it, and it has no permission to patch, delete, list, or watch.
 */
export class _KubernetesAgentSandboxClaimAuthority implements AgentSandboxClaimAuthority
{
	/** Connects this authority to the server identity's create-and-get custom-object client. */
	public constructor(private readonly customApi: AgentSandboxClaimCustomObjectsApi) {}

	/**
	 * Creates the generation's claim or proves that a conflicting prior claim represents the same lease.
	 *
	 * @param command - The validated input produced after a computer generation is admitted.
	 * @returns A receipt distinguishing a new claim from a verified idempotent retry.
	 * @throws {Error} When input is malformed, Kubernetes fails, or an existing claim differs.
	 */
	public async ensure(command: AgentSandboxClaimCommand): Promise<AgentSandboxClaimReceipt>
	{
		// 1. Build the fixed body before I/O so malformed coordinates never reach Kubernetes.
		const expected = _BuildExpectedClaim(command);
		const self = this;
		return ___DoWithTrace("agent_sandbox.claim.ensure", {
			namespace: command.namespace,
			siloId: command.siloId,
			computerId: command.computerId,
			generation: command.generation,
			claimName: expected.claimName,
		}, async function _Ensure(): Promise<AgentSandboxClaimReceipt>
		{
			try
			{
				// 2. Create first because the deterministic name makes the common path one request.
				await self.customApi.createNamespacedCustomObject({
					group: _AGENT_SANDBOX_API_GROUP,
					version: _AGENT_SANDBOX_API_VERSION,
					namespace: command.namespace,
					plural: _AGENT_SANDBOX_CLAIM_PLURAL,
					body: expected.manifest,
				});
				return { namespace: command.namespace, claimName: expected.claimName, disposition: "created" };
			}
			catch (error)
			{
				if (!_IsK8sConflict(error))
					throw error;
				// 3. Read the same name after a 409; no broad lookup can adopt another generation.
				const existing = await self.customApi.getNamespacedCustomObject({
					group: _AGENT_SANDBOX_API_GROUP,
					version: _AGENT_SANDBOX_API_VERSION,
					namespace: command.namespace,
					plural: _AGENT_SANDBOX_CLAIM_PLURAL,
					name: expected.claimName,
				});
				if (!_MatchesExpectedClaim(existing, expected.manifest))
					throw new Error(`Agent Sandbox claim '${expected.claimName}' conflicts with a different immutable lease`);
				return { namespace: command.namespace, claimName: expected.claimName, disposition: "existing" };
			}
		});
	}
}

/** Creates the complete, admission-policy-safe resource body from an already admitted command. */
function _BuildExpectedClaim(command: AgentSandboxClaimCommand): { readonly claimName: string; readonly manifest: Record<string, unknown> }
{
	// 1. Reject an impossible claim before deriving the deterministic Kubernetes name.
	_ValidateCommand(command);
	// 2. Bind retries to a computer generation rather than a transient request identifier.
	const claimName = __AgentSandboxClaimName(command.computerId, command.generation);
	return {
		claimName,
		manifest: {
			apiVersion: `${_AGENT_SANDBOX_API_GROUP}/${_AGENT_SANDBOX_API_VERSION}`,
			kind: "SandboxClaim",
			metadata: {
				name: claimName,
				namespace: command.namespace,
				labels: {
					"opencrane.ai/silo-id": command.siloId,
					"opencrane.ai/computer-id": command.computerId,
					"opencrane.ai/computer-generation": String(command.generation),
					"opencrane.ai/profile": command.profile,
				},
				annotations: { "opencrane.ai/lease-reason": command.reason },
			},
			spec: {
				warmPoolRef: { name: command.warmPoolName },
				lifecycle: { shutdownPolicy: "DeleteForeground", shutdownTime: command.shutdownTime.toISOString() },
				additionalPodMetadata: { labels: _PodLabels(command) },
			},
		},
	};
}

/** Derives the sole deterministic Kubernetes claim name for one computer generation. */
export function __AgentSandboxClaimName(computerId: string, generation: number): string
{
	if (computerId.length > 63 || !_COMPUTER_ID.test(computerId))
		throw new Error("Agent Sandbox claim computerId must be a bounded computer DNS label");
	if (!Number.isSafeInteger(generation) || generation < 1)
		throw new Error("Agent Sandbox claim generation must be a positive safe integer");
	const claimName = `${computerId}-g${generation}`;
	if (claimName.length > 253)
		throw new Error("Agent Sandbox claim name is too long");
	return claimName;
}

/** Refuses malformed input before this authority can submit a Kubernetes request. */
function _ValidateCommand(command: AgentSandboxClaimCommand): void
{
	// 1. Keep the Kubernetes location within the chart's DNS-label admission boundary.
	if (!_IsDnsLabel(command.namespace))
		throw new Error("Agent Sandbox claim namespace must be a DNS label");
	if (!_IsDnsLabel(command.siloId))
		throw new Error("Agent Sandbox claim siloId must be a DNS label");
	// 2. Preserve the claim-name and generation fence required by the admission policy.
	__AgentSandboxClaimName(command.computerId, command.generation);
	// 3. Restrict profile and pool selection to names the release policy can admit.
	if (!_IsDnsLabel(command.profile))
		throw new Error("Agent Sandbox claim profile must be a DNS label");
	if (!_IsDnsLabel(command.warmPoolName))
		throw new Error("Agent Sandbox claim warmPoolName must be a DNS label");
	if (!_IsDnsLabel(command.podLabels.applicationName) || !_IsDnsLabel(command.podLabels.releaseName))
		throw new Error("Agent Sandbox claim Pod labels must be DNS labels");
	// 4. Preserve the policy's closed reason vocabulary and valid foreground-delete deadline.
	if (!Object.values(AgentSandboxClaimReason).includes(command.reason))
		throw new Error("Agent Sandbox claim reason is unsupported");
	if (!(command.shutdownTime instanceof Date) || Number.isNaN(command.shutdownTime.getTime()))
		throw new Error("Agent Sandbox claim shutdownTime must be a valid Date");
}

/** Returns whether one value is a Kubernetes DNS label accepted by the released admission policy. */
function _IsDnsLabel(value: string): boolean
{
	return value.length <= 63 && _DNS_LABEL.test(value);
}

/** Compares a 409-retrieved claim to every immutable field this authority would create. */
function _MatchesExpectedClaim(value: unknown, expected: Record<string, unknown>): boolean
{
	// 1. Refuse an unreadable Kubernetes response before checking its claimed identity.
	if (!_IsRecord(value) || !_IsRecord(expected.metadata) || !_IsRecord(expected.spec))
		return false;
	if (value.apiVersion !== expected.apiVersion || value.kind !== expected.kind)
		return false;
	const metadata = value.metadata;
	const expectedMetadata = expected.metadata;
	const spec = value.spec;
	const expectedSpec = expected.spec;
	// 2. Check the resource envelope before considering the mutable-looking nested values.
	if (!_IsRecord(metadata) || !_IsRecord(spec))
		return false;
	// 3. Compare every policy-controlled lease field before accepting a duplicate as idempotent.
	return _MatchesRequiredRecord(metadata, expectedMetadata, ["name", "namespace"])
		&& _HasExactKeys(spec, ["warmPoolRef", "lifecycle", "additionalPodMetadata"])
		&& _MatchesExactRecord(metadata.labels, expectedMetadata.labels, ["opencrane.ai/silo-id", "opencrane.ai/computer-id", "opencrane.ai/computer-generation", "opencrane.ai/profile"])
		&& _MatchesExactRecord(metadata.annotations, expectedMetadata.annotations, ["opencrane.ai/lease-reason"])
		&& _MatchesExactRecord(spec.warmPoolRef, expectedSpec.warmPoolRef, ["name"])
		&& _MatchesExactRecord(spec.lifecycle, expectedSpec.lifecycle, ["shutdownPolicy", "shutdownTime"])
		&& _HasExactKeys(spec.additionalPodMetadata, ["labels"])
		&& _HasExactKeys(expectedSpec.additionalPodMetadata, ["labels"])
		&& _MatchesExactRecord(_NestedRecord(spec.additionalPodMetadata, "labels"), _NestedRecord(expectedSpec.additionalPodMetadata, "labels"), ["app.kubernetes.io/name", "app.kubernetes.io/instance", "app.kubernetes.io/component", "opencrane.ai/computer-id"]);
}

/** Builds the only Pod labels a claim may add after the release admitted its computer generation. */
function _PodLabels(command: AgentSandboxClaimCommand): Record<string, string>
{
	return {
		"app.kubernetes.io/name": command.podLabels.applicationName,
		"app.kubernetes.io/instance": command.podLabels.releaseName,
		"app.kubernetes.io/component": "agent-sandbox",
		"opencrane.ai/computer-id": command.computerId,
	};
}

/** Reads one nested Kubernetes record without accepting an arbitrary object shape. */
function _NestedRecord(value: unknown, key: string): Record<string, unknown> | null
{
	return _IsRecord(value) && _IsRecord(value[key]) ? value[key] : null;
}

/** Checks that an untrusted Kubernetes record contains each named immutable field. */
function _MatchesRequiredRecord(value: unknown, expected: unknown, keys: readonly string[]): boolean
{
	if (!_IsRecord(value) || !_IsRecord(expected))
		return false;
	return keys.every(function _MatchesKey(key): boolean { return value[key] === expected[key]; });
}

/** Checks that an untrusted Kubernetes record has no extra mutable claim fields. */
function _MatchesExactRecord(value: unknown, expected: unknown, keys: readonly string[]): boolean
{
	if (!_IsRecord(value) || !_IsRecord(expected))
		return false;
	if (!_HasExactKeys(value, keys) || !_HasExactKeys(expected, keys))
		return false;
	return keys.every(function _MatchesKey(key): boolean { return value[key] === expected[key]; });
}

/** Checks that an untrusted Kubernetes record contains no fields outside one immutable shape. */
function _HasExactKeys(value: unknown, keys: readonly string[]): boolean
{
	return _IsRecord(value) && Object.keys(value).length === keys.length && keys.every(function _HasKey(key): boolean { return Object.hasOwn(value, key); });
}

/** Narrows a Kubernetes response object without trusting its shape. */
function _IsRecord(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
