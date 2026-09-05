import type * as k8s from "@kubernetes/client-node";

const _GROUP = "extensions.agents.x-k8s.io";
const _VERSION = "v1beta1";
const _PLURAL = "sandboxclaims";
const _DNS_LABEL = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/;

/** Supplies the release-owned values needed to realize one fenced computer generation. */
export interface AgentSandboxClaimCommand
{
	readonly siloId: string;
	readonly computerId: string;
	readonly leaseId: string;
	readonly generation: number;
	readonly namespace: string;
	readonly profileName: string;
	readonly warmPoolName: string;
	readonly expiresAt: string;
	readonly reason: "activation_requested" | "recovery_requested";
}

/** Reports the converged claim identity without treating controller readiness as claim creation. */
export interface AgentSandboxClaimResult
{
	readonly claimId: string;
	readonly outcome: "created" | "existing";
	readonly sandboxId: string | null;
}

interface SandboxClaimResource
{
	readonly metadata?: { readonly name?: string; readonly namespace?: string; readonly labels?: Readonly<Record<string, string>>; readonly annotations?: Readonly<Record<string, string>> };
	readonly spec?: {
		readonly warmPoolRef?: { readonly name?: string };
		readonly lifecycle?: { readonly shutdownPolicy?: string; readonly shutdownTime?: string };
		readonly additionalPodMetadata?: { readonly labels?: Readonly<Record<string, string>>; readonly annotations?: Readonly<Record<string, string>> };
	};
	readonly status?: { readonly sandbox?: { readonly name?: string } };
}

/**
 * Creates or observes one deterministic upstream SandboxClaim for an admitted computer generation.
 *
 * The adapter deliberately accepts already-authorized, release-resolved values. It neither chooses
 * a profile nor interprets Kubernetes status as product authority. A retry observes the exact same
 * resource, while any conflicting resource under the deterministic name fails closed.
 */
export class AgentSandboxClaimAdapter
{
	public constructor(private readonly api: Pick<k8s.CustomObjectsApi, "createNamespacedCustomObject" | "getNamespacedCustomObject">) {}

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
			return { claimId, outcome: "created", sandboxId: null };
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
	return { claimId, outcome: "existing", sandboxId: typeof sandboxId === "string" && sandboxId.length > 0 ? sandboxId : null };
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
