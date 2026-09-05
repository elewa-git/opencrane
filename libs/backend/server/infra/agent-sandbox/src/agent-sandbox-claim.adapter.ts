import type * as k8s from "@kubernetes/client-node";
import type { AgentSandboxClaimCommand, AgentSandboxClaimReleaseCommand, AgentSandboxClaimResult } from "./agent-sandbox-claim.types";

const _GROUP = "extensions.agents.x-k8s.io";
const _VERSION = "v1beta1";
const _PLURAL = "sandboxclaims";
const _DNS_LABEL = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/;

interface SandboxClaimResource
{
	readonly metadata?: { readonly name?: string; readonly namespace?: string; readonly labels?: Readonly<Record<string, string>>; readonly annotations?: Readonly<Record<string, string>> };
	readonly spec?: {
		readonly warmPoolRef?: { readonly name?: string };
		readonly lifecycle?: { readonly shutdownPolicy?: string; readonly shutdownTime?: string };
		readonly additionalPodMetadata?: { readonly labels?: Readonly<Record<string, string>>; readonly annotations?: Readonly<Record<string, string>> };
	};
	readonly status?: { readonly sandbox?: { readonly name?: string; readonly serviceFQDN?: string } };
}

/**
 * Creates or observes one deterministic upstream SandboxClaim for an admitted computer generation.
 *
 * The adapter deliberately accepts already-authorized, release-resolved values. It neither chooses
 * a profile nor interprets Kubernetes status as product authority. A retry observes the exact same
 * resource, while any conflicting resource under the deterministic name fails closed.
 *
 * @see https://pkg.go.dev/sigs.k8s.io/agent-sandbox@v1.0.0/extensions/api/v1beta1 for SandboxClaim serviceFQDN ownership.
 */
export class AgentSandboxClaimAdapter
{
	public constructor(private readonly api: Pick<k8s.CustomObjectsApi, "createNamespacedCustomObject" | "deleteNamespacedCustomObject" | "getNamespacedCustomObject">) {}

	/** Converges the exact claim and rejects malformed input or a conflicting existing resource. */
	public async claim(command: AgentSandboxClaimCommand): Promise<AgentSandboxClaimResult>
	{
		_ValidateCommand(command);
		const claimId = `${command.computerId}-g${command.generation}`;
		const desired = _DesiredClaim(command, claimId);
		const existing = await this._read(command.namespace, claimId);
		if (existing !== null)
			return _ExistingResult(existing, desired, claimId);

		try
		{
			await this.api.createNamespacedCustomObject({ group: _GROUP, version: _VERSION, namespace: command.namespace, plural: _PLURAL, body: desired });
			return { claimId, outcome: "created", sandboxId: null, serviceFQDN: null };
		}
		catch (error)
		{
			if (_StatusCode(error) !== 409)
				throw error;
			const raced = await this._read(command.namespace, claimId);
			if (raced === null)
				throw new Error("Agent Sandbox reported a claim conflict but the deterministic claim is absent");
			return _ExistingResult(raced, desired, claimId);
		}
	}

	/** Deletes only the claim whose immutable labels still prove the terminal lease coordinates. */
	public async release(command: AgentSandboxClaimReleaseCommand): Promise<"released" | "absent">
	{
		_ValidateReleaseCommand(command);
		const existing = await this._read(command.namespace, command.claimId);
		if (existing === null)
			return "absent";
		const labels = existing.metadata?.labels;
		if (existing.metadata?.name !== command.claimId || existing.metadata?.namespace !== command.namespace || labels?.["opencrane.ai/computer-id"] !== command.computerId || labels?.["opencrane.ai/computer-generation"] !== String(command.generation) || labels?.["opencrane.ai/computer-lease-id"] !== command.leaseId)
			throw new Error("Agent Sandbox claim release does not match the terminal computer lease");
		try
		{
			await this.api.deleteNamespacedCustomObject({ group: _GROUP, version: _VERSION, namespace: command.namespace, plural: _PLURAL, name: command.claimId, body: { propagationPolicy: "Foreground" } });
		}
		catch (error)
		{
			if (_StatusCode(error) !== 404)
				throw error;
		}
		return "released";
	}

	private async _read(namespace: string, name: string): Promise<SandboxClaimResource | null>
	{
		try
		{
			return await this.api.getNamespacedCustomObject({ group: _GROUP, version: _VERSION, namespace, plural: _PLURAL, name }) as SandboxClaimResource;
		}
		catch (error)
		{
			if (_StatusCode(error) === 404)
				return null;
			throw error;
		}
	}
}

/** Rejects broad or stale deletion coordinates before reading Kubernetes. */
function _ValidateReleaseCommand(command: AgentSandboxClaimReleaseCommand): void
{
	for (const value of [command.namespace, command.claimId, command.computerId, command.leaseId])
		if (!_DNS_LABEL.test(value) || value.length > 63)
			throw new Error("Agent Sandbox claim release coordinates must be Kubernetes DNS labels");
	if (!command.computerId.startsWith("computer-") || command.claimId !== `${command.computerId}-g${command.generation}` || !Number.isSafeInteger(command.generation) || command.generation < 1)
		throw new Error("Agent Sandbox claim release requires its deterministic computer generation");
}

function _DesiredClaim(command: AgentSandboxClaimCommand, claimId: string): SandboxClaimResource & { readonly apiVersion: string; readonly kind: "SandboxClaim" }
{
	return {
		apiVersion: `${_GROUP}/${_VERSION}`,
		kind: "SandboxClaim",
		metadata: {
			name: claimId,
			namespace: command.namespace,
			labels: {
				"opencrane.ai/silo-id": command.siloId,
				"opencrane.ai/computer-id": command.computerId,
				"opencrane.ai/computer-generation": String(command.generation),
				"opencrane.ai/computer-lease-id": command.leaseId,
				"opencrane.ai/profile": command.profileName,
			},
			annotations: { "opencrane.ai/lease-reason": command.reason },
		},
		spec: {
			warmPoolRef: { name: command.warmPoolName },
			lifecycle: { shutdownPolicy: "DeleteForeground", shutdownTime: command.expiresAt },
			additionalPodMetadata: {
				labels: {
					"opencrane.ai/computer-id": command.computerId,
					"opencrane.ai/computer-generation": String(command.generation),
					"opencrane.ai/computer-lease-id": command.leaseId,
				},
				annotations: {},
			},
		},
	};
}

function _ExistingResult(existing: SandboxClaimResource, desired: SandboxClaimResource, claimId: string): AgentSandboxClaimResult
{
	if (!_SameStringRecord(existing.metadata?.labels, desired.metadata?.labels)
		|| !_SameStringRecord(existing.metadata?.annotations, desired.metadata?.annotations)
		|| existing.spec?.warmPoolRef?.name !== desired.spec?.warmPoolRef?.name
		|| existing.spec?.lifecycle?.shutdownPolicy !== desired.spec?.lifecycle?.shutdownPolicy
		|| existing.spec?.lifecycle?.shutdownTime !== desired.spec?.lifecycle?.shutdownTime
		|| !_SameStringRecord(existing.spec?.additionalPodMetadata?.labels, desired.spec?.additionalPodMetadata?.labels)
		|| !_SameStringRecord(existing.spec?.additionalPodMetadata?.annotations, desired.spec?.additionalPodMetadata?.annotations)
		|| existing.metadata?.name !== desired.metadata?.name
		|| existing.metadata?.namespace !== desired.metadata?.namespace)
		throw new Error("Agent Sandbox deterministic claim conflicts with the admitted computer generation");
	const sandboxId = existing.status?.sandbox?.name;
	const serviceFQDN = existing.status?.sandbox?.serviceFQDN;
	return { claimId, outcome: "existing", sandboxId: _OptionalIdentifier(sandboxId), serviceFQDN: _OptionalServiceFqdn(serviceFQDN) };
}

function _OptionalIdentifier(value: unknown): string | null
{
	return typeof value === "string" && value.length > 0 ? value : null;
}

function _OptionalServiceFqdn(value: unknown): string | null
{
	return typeof value === "string" && _ServiceFqdn(value) ? value : null;
}

/** Accept only a controller-reported cluster-local DNS name, never a URL or caller-selected host. */
function _ServiceFqdn(value: string): boolean
{
	return value.length <= 253 && value.endsWith(".svc.cluster.local") && value.split(".").every(label => _DNS_LABEL.test(label));
}

function _SameStringRecord(left: Readonly<Record<string, string>> | undefined, right: Readonly<Record<string, string>> | undefined): boolean
{
	if (left === undefined || right === undefined)
		return left === right;
	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	return leftKeys.length === rightKeys.length && leftKeys.every(function _SameEntry(key) { return left[key] === right[key]; });
}

function _ValidateCommand(command: AgentSandboxClaimCommand): void
{
	for (const value of [command.siloId, command.computerId, command.leaseId, command.namespace, command.profileName, command.warmPoolName])
		if (!_DNS_LABEL.test(value) || value.length > 63)
			throw new Error("Agent Sandbox claim coordinates must be Kubernetes DNS labels");
	if (!command.computerId.startsWith("computer-") || !Number.isSafeInteger(command.generation) || command.generation < 1)
		throw new Error("Agent Sandbox claims require a computer identifier and positive generation");
	if (Number.isNaN(Date.parse(command.expiresAt)))
		throw new Error("Agent Sandbox claims require an ISO shutdown timestamp");
}

function _StatusCode(error: unknown): number | null
{
	if (typeof error !== "object" || error === null)
		return null;
	const candidate = error as { readonly code?: unknown; readonly response?: { readonly statusCode?: unknown } };
	if (typeof candidate.code === "number")
		return candidate.code;
	return typeof candidate.response?.statusCode === "number" ? candidate.response.statusCode : null;
}
