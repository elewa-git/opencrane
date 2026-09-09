import { PatchStrategy, setHeaderOptions, type CustomObjectsApi } from "@kubernetes/client-node";
import type { AgentSandboxClaimCommand, AgentSandboxClaimReleaseCommand, AgentSandboxClaimRenewCommand, AgentSandboxClaimResult, AgentSandboxClaimStatus, _SandboxClaimResource, _SandboxResource } from "./agent-sandbox-claim.types";

/** Selects the installed claim API. */
const _GROUP = "extensions.agents.x-k8s.io";
/** Uses the version served by Agent Sandbox v0.5.3. */
const _VERSION = "v1beta1";
/** Addresses claims without listing other leases. */
const _PLURAL = "sandboxclaims";
/** Restricts Kubernetes names and copied lease labels. */
const _DNS_LABEL = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/;
/** Allows the pinned controller's bookkeeping while keeping application annotations immutable. */
const _CONTROLLER_ANNOTATIONS = new Set(["agents.x-k8s.io/controller-first-observed-at", "opentelemetry.io/trace-context", "agents.x-k8s.io/creation-latency-recorded", "agents.x-k8s.io/sandbox-name"]);

/**
 * Creates or observes one deterministic upstream SandboxClaim for an admitted computer generation.
 *
 * The adapter deliberately accepts already-authorized, release-resolved values. It neither chooses
 * a profile nor interprets Kubernetes status as product authority. A retry observes the exact same
 * resource, while any conflicting resource under the deterministic name fails closed.
 *
 * @see https://github.com/kubernetes-sigs/agent-sandbox/blob/v0.5.3/extensions/api/v1beta1/sandboxclaim_types.go for the claim status contract.
 * @see https://github.com/kubernetes-sigs/agent-sandbox/blob/v0.5.3/api/v1beta1/sandbox_types.go for Sandbox Service status.
 */
export class AgentSandboxClaimAdapter
{
	/** Uses the server's namespace-scoped Kubernetes client. */
	public constructor(private readonly api: Pick<CustomObjectsApi, "createNamespacedCustomObject" | "deleteNamespacedCustomObject" | "getNamespacedCustomObject" | "patchNamespacedCustomObject">) {}

	/** Converges the exact claim and rejects malformed input or a conflicting existing resource. */
	public async claim(command: AgentSandboxClaimCommand): Promise<AgentSandboxClaimResult>
	{
		_ValidateCommand(command);
		const claimId = `${command.computerId}-g${command.generation}`;
		const desired = _DesiredClaim(command, claimId);
		const existing = await this._read(command.namespace, claimId);
		if (existing !== null)
			return this._existingResult(existing, desired, claimId);

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
			return this._existingResult(raced, desired, claimId);
		}
	}

	/** Reads the controller's current view of the exact claim, or null once the claim is gone. */
	public async inspect(command: AgentSandboxClaimReleaseCommand): Promise<AgentSandboxClaimStatus | null>
	{
		_ValidateReleaseCommand(command);
		const existing = await this._read(command.namespace, command.claimId);
		if (existing === null)
			return null;
		_AssertLeaseLabels(existing, command, "Agent Sandbox claim inspection does not match the computer lease");
		const shutdownTime = existing.spec?.lifecycle?.shutdownTime;
		const assignment = await this._assignment(existing, command.namespace);
		return { claimId: command.claimId, ...assignment, shutdownTime: typeof shutdownTime === "string" ? shutdownTime : null };
	}

	/** Moves the claim's shutdown time later so the controller keeps the leased Pod alive. */
	public async renew(command: AgentSandboxClaimRenewCommand): Promise<"renewed" | "absent">
	{
		_ValidateReleaseCommand(command);
		if (Number.isNaN(Date.parse(command.expiresAt)))
			throw new Error("Agent Sandbox claim renewal requires an ISO shutdown timestamp");
		const existing = await this._read(command.namespace, command.claimId);
		if (existing === null)
			return "absent";
		_AssertLeaseLabels(existing, command, "Agent Sandbox claim renewal does not match the computer lease");
		const currentShutdown = existing.spec?.lifecycle?.shutdownTime;
		const expiresAt = _ShutdownTime(command.expiresAt);
		if (typeof currentShutdown !== "string" || Number.isNaN(Date.parse(currentShutdown)) || Date.parse(currentShutdown) >= Date.parse(expiresAt))
			throw new Error("Agent Sandbox claim renewal must move the shutdown time later");
		// The read version prevents a concurrent renewal or replacement from being overwritten.
		await this.api.patchNamespacedCustomObject({ group: _GROUP, version: _VERSION, namespace: command.namespace, plural: _PLURAL, name: command.claimId, body: { metadata: _ResourcePreconditions(existing), spec: { lifecycle: { shutdownTime: expiresAt } } } }, setHeaderOptions("Content-Type", PatchStrategy.MergePatch));
		return "renewed";
	}

	/** Deletes only the claim whose immutable labels still prove the terminal lease coordinates. */
	public async release(command: AgentSandboxClaimReleaseCommand): Promise<"released" | "absent">
	{
		_ValidateReleaseCommand(command);
		const existing = await this._read(command.namespace, command.claimId);
		if (existing === null)
			return "absent";
		_AssertLeaseLabels(existing, command, "Agent Sandbox claim release does not match the terminal computer lease");
		try
		{
			await this.api.deleteNamespacedCustomObject({ group: _GROUP, version: _VERSION, namespace: command.namespace, plural: _PLURAL, name: command.claimId, body: { propagationPolicy: "Foreground", preconditions: _ResourcePreconditions(existing) } });
		}
		catch (error)
		{
			if (_StatusCode(error) !== 404)
				throw error;
		}
		return "released";
	}

	/** Resolves an observed claim only after checking every admitted request field. */
	private async _existingResult(existing: _SandboxClaimResource, desired: _SandboxClaimResource, claimId: string): Promise<AgentSandboxClaimResult>
	{
		_AssertSameClaim(existing, desired);
		const assignment = await this._assignment(existing, desired.metadata!.namespace!);
		return { claimId, outcome: "existing", ...assignment };
	}

	/**
	 * Reads the named Sandbox and verifies ownership before exposing its Service address.
	 * The computer needs an active lease to obtain its review credential, so waiting for Ready here
	 * would prevent the same bootstrap that makes its Pod ready.
	 */
	private async _assignment(claim: _SandboxClaimResource, namespace: string): Promise<{ readonly sandboxId: string | null; readonly serviceFQDN: string | null }>
	{
		const sandboxId = claim.status?.sandbox?.name;
		if (sandboxId === undefined || sandboxId === "")
			return { sandboxId: null, serviceFQDN: null };
		if (typeof sandboxId !== "string" || !_DnsName(sandboxId))
			throw new Error("Agent Sandbox claim reports an invalid Sandbox name");
		let sandbox: _SandboxResource;
		try
		{
			sandbox = await this.api.getNamespacedCustomObject({ group: "agents.x-k8s.io", version: _VERSION, namespace, plural: "sandboxes", name: sandboxId }) as _SandboxResource;
		}
		catch (error)
		{
			if (_StatusCode(error) === 404)
				return { sandboxId, serviceFQDN: null };
			throw error;
		}
		_AssertSandboxOwner(sandbox, claim, namespace, sandboxId);
		const service = sandbox.status?.service;
		const serviceFQDN = sandbox.status?.serviceFQDN;
		if (serviceFQDN === undefined || serviceFQDN === "")
			return { sandboxId, serviceFQDN: null };
		if (typeof service !== "string" || service.length > 63 || !_DNS_LABEL.test(service) || serviceFQDN !== `${service}.${namespace}.svc.cluster.local`)
			throw new Error("Agent Sandbox Service address does not match its namespace and controller-reported Service");
		return { sandboxId, serviceFQDN };
	}

	/** Reads the named claim and rejects a mismatched API identity before using its fields. */
	private async _read(namespace: string, name: string): Promise<_SandboxClaimResource | null>
	{
		try
		{
			const claim = await this.api.getNamespacedCustomObject({ group: _GROUP, version: _VERSION, namespace, plural: _PLURAL, name }) as _SandboxClaimResource;
			if (claim.apiVersion !== `${_GROUP}/${_VERSION}` || claim.kind !== "SandboxClaim" || claim.metadata?.name !== name || claim.metadata?.namespace !== namespace)
				throw new Error("Agent Sandbox claim response does not match the requested resource");
			_ResourcePreconditions(claim);
			return claim;
		}
		catch (error)
		{
			if (_StatusCode(error) === 404)
				return null;
			throw error;
		}
	}
}

/** Rejects a claim whose immutable labels no longer prove the requested lease coordinates. */
function _AssertLeaseLabels(existing: _SandboxClaimResource, command: AgentSandboxClaimReleaseCommand, message: string): void
{
	const labels = existing.metadata?.labels;
	if (existing.metadata?.name !== command.claimId || existing.metadata?.namespace !== command.namespace || labels?.["opencrane.ai/computer-id"] !== command.computerId || labels?.["opencrane.ai/computer-generation"] !== String(command.generation) || labels?.["opencrane.ai/computer-lease-id"] !== command.leaseId)
		throw new Error(message);
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

/** Translates admitted lease coordinates into the pinned upstream claim request. */
function _DesiredClaim(command: AgentSandboxClaimCommand, claimId: string): _SandboxClaimResource & { readonly apiVersion: string; readonly kind: "SandboxClaim" }
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
			lifecycle: { shutdownPolicy: "DeleteForeground", shutdownTime: _ShutdownTime(command.expiresAt) },
			additionalPodMetadata: {
				labels: {
					"opencrane.ai/computer-id": command.computerId,
					"opencrane.ai/computer-generation": String(command.generation),
					"opencrane.ai/computer-lease-id": command.leaseId,
				},
			},
		},
	};
}

/** Rejects admitted fields that differ after upstream serialization and bookkeeping. */
function _AssertSameClaim(existing: _SandboxClaimResource, desired: _SandboxClaimResource): void
{
	if (!_SameStringRecord(existing.metadata?.labels, desired.metadata?.labels)
		|| !_SameClaimAnnotations(existing.metadata?.annotations, desired.metadata?.annotations)
		|| existing.spec?.warmPoolRef?.name !== desired.spec?.warmPoolRef?.name
		|| existing.spec?.lifecycle?.shutdownPolicy !== desired.spec?.lifecycle?.shutdownPolicy
		|| _ShutdownTime(existing.spec?.lifecycle?.shutdownTime) !== desired.spec?.lifecycle?.shutdownTime
		|| existing.spec?.lifecycle?.ttlSecondsAfterFinished !== undefined
		|| existing.spec?.env !== undefined
		|| existing.spec?.volumeClaimTemplates !== undefined
		|| !_SameStringRecord(existing.spec?.additionalPodMetadata?.labels, desired.spec?.additionalPodMetadata?.labels)
		|| !_SameStringRecord(existing.spec?.additionalPodMetadata?.annotations ?? {}, {})
		|| existing.metadata?.name !== desired.metadata?.name
		|| existing.metadata?.namespace !== desired.metadata?.namespace)
		throw new Error("Agent Sandbox deterministic claim conflicts with the admitted computer generation");
}

/** Accepts just the bookkeeping keys written by the pinned claim controller. */
function _SameClaimAnnotations(actual: Readonly<Record<string, string>> | undefined, desired: Readonly<Record<string, string>> | undefined): boolean
{
	if (actual === undefined || desired === undefined)
		return false;
	return Object.keys(desired).every(key => actual[key] === desired[key])
		&& Object.keys(actual).every(key => typeof actual[key] === "string" && (Object.hasOwn(desired, key) || _CONTROLLER_ANNOTATIONS.has(key)));
}

/** Requires the owning claim UID as well as its name because Kubernetes can reuse names. */
function _AssertSandboxOwner(sandbox: _SandboxResource, claim: _SandboxClaimResource, namespace: string, sandboxId: string): void
{
	const owners = sandbox.metadata?.ownerReferences?.filter(owner => owner.controller === true) ?? [];
	const owner = owners[0];
	if (sandbox.apiVersion !== `agents.x-k8s.io/${_VERSION}` || sandbox.kind !== "Sandbox" || sandbox.metadata?.name !== sandboxId || sandbox.metadata?.namespace !== namespace
		|| owners.length !== 1 || owner?.apiVersion !== `${_GROUP}/${_VERSION}` || owner.kind !== "SandboxClaim" || owner.name !== claim.metadata?.name || owner.uid !== claim.metadata?.uid)
		throw new Error("Agent Sandbox does not belong to the observed computer claim");
}

/** Returns the API preconditions that prevent modifying a replaced or concurrently changed claim. */
function _ResourcePreconditions(claim: _SandboxClaimResource): { readonly uid: string; readonly resourceVersion: string }
{
	const uid = claim.metadata?.uid;
	const resourceVersion = claim.metadata?.resourceVersion;
	if (typeof uid !== "string" || uid.length === 0 || typeof resourceVersion !== "string" || resourceVersion.length === 0)
		throw new Error("Agent Sandbox claim lacks its Kubernetes UID or resource version");
	return { uid, resourceVersion };
}

/**
 * Matches metav1.Time's whole-second JSON representation without extending the admitted expiry.
 * @see https://github.com/kubernetes/apimachinery/blob/v0.36.2/pkg/apis/meta/v1/time.go for the controller dependency's timestamp encoding.
 */
function _ShutdownTime(value: string | undefined): string
{
	if (value === undefined || Number.isNaN(Date.parse(value)))
		throw new Error("Agent Sandbox claim requires a valid shutdown timestamp");
	return new Date(Math.floor(Date.parse(value) / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

/** Accepts a Kubernetes DNS subdomain while excluding URL syntax and namespace traversal. */
function _DnsName(value: string): boolean
{
	return value.length <= 253 && value.split(".").every(label => label.length <= 63 && _DNS_LABEL.test(label));
}

/** Compares every key so unrecognised copied lease metadata fails closed. */
function _SameStringRecord(left: Readonly<Record<string, string>> | undefined, right: Readonly<Record<string, string>> | undefined): boolean
{
	if (left === undefined || right === undefined)
		return left === right;
	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	return leftKeys.length === rightKeys.length && leftKeys.every(function _SameEntry(key) { return left[key] === right[key]; });
}

/** Rejects malformed coordinates before making a Kubernetes request. */
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

/** Reads the Kubernetes client status without inspecting sensitive response bodies. */
function _StatusCode(error: unknown): number | null
{
	if (typeof error !== "object" || error === null)
		return null;
	const candidate = error as { readonly code?: unknown; readonly response?: { readonly statusCode?: unknown } };
	if (typeof candidate.code === "number")
		return candidate.code;
	return typeof candidate.response?.statusCode === "number" ? candidate.response.statusCode : null;
}
