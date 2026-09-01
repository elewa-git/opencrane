import { _IsK8sNotFound } from "@opencrane/backend/server/infra/api";

import type { AgentSandboxClaimCustomObjectsApi, AgentSandboxCoreApi, AgentSandboxRuntimePod, AgentSandboxRuntimePodCommand, AgentSandboxRuntimePodReader } from "./agent-sandbox-claims.types";

/** Names the Agent Sandbox API that owns Sandbox resources. */
const _AGENT_SANDBOX_API_GROUP = "agents.x-k8s.io";
/** Names the installed Agent Sandbox Sandbox resource version. */
const _AGENT_SANDBOX_API_VERSION = "v1beta1";
/** Names the namespaced Sandbox collection. */
const _AGENT_SANDBOX_PLURAL = "sandboxes";

/** Couples the v1 Sandbox-name Pod convention to the exact Sandbox object that owns it. */
interface _SandboxBackingPod
{
	/** Names the backing Pod, which Agent Sandbox v1 fixes to the Sandbox name. */
	readonly podName: string;
	/** Identifies the exact current Sandbox object that must control the Pod. */
	readonly sandboxUid: string;
}

/**
 * Resolves one ready Sandbox assignment into its exact controller-owned Pod identity.
 *
 * A claim reports a Sandbox resource, not durable Pod authority. This adapter requires that
 * resource's v1 fixed backing-Pod name and the Pod's exact owner reference before it returns a UID,
 * so a same-name Sandbox replacement cannot silently retain the prior computer lease.
 */
export class _KubernetesAgentSandboxRuntimePodReader implements AgentSandboxRuntimePodReader
{
	/** Connects the narrow Sandbox custom-resource and Core Pod read ports. */
	public constructor(private readonly customApi: AgentSandboxClaimCustomObjectsApi, private readonly coreApi: AgentSandboxCoreApi) {}

	/**
	 * Reads one assigned Sandbox and verifies its v1 name-matched backing Pod before returning its identity.
	 *
	 * @param command - Supplies the trusted Sandbox namespace, id, and expected ServiceAccount.
	 * @returns The exact Pod UID only while all controller ownership evidence matches.
	 * @throws {Error} Propagates unavailable Kubernetes reads and rejects malformed controller resources.
	 */
	public async read(command: AgentSandboxRuntimePodCommand): Promise<AgentSandboxRuntimePod | null>
	{
		// 1. Read the claim-assigned Sandbox because v1 fixes its backing Pod name to this resource name.
		const sandbox = await this._ReadSandbox(command);
		if (sandbox === null)
			return null;
		// 2. Read the named Pod without broad discovery, so another workload cannot be adopted by selection.
		const backingPod = _SandboxBackingPod(sandbox, command);
		const pod = await this._ReadPod(command.namespace, backingPod.podName);
		if (pod === null)
			return null;
		// 3. Retain the immutable UID only after controller ownership and template identity both agree.
		return _RuntimePod(pod, command, backingPod);
	}

	/** Reads the claim-assigned Sandbox without accepting a caller-selected custom-resource name. */
	private async _ReadSandbox(command: AgentSandboxRuntimePodCommand): Promise<unknown | null>
	{
		try
		{
			return await this.customApi.getNamespacedCustomObject({
				group: _AGENT_SANDBOX_API_GROUP,
				version: _AGENT_SANDBOX_API_VERSION,
				namespace: command.namespace,
				plural: _AGENT_SANDBOX_PLURAL,
				name: command.sandboxId,
			});
		}
		catch (error)
		{
			if (_IsK8sNotFound(error))
				return null;
			throw error;
		}
	}

	/** Reads the one controller-published backing Pod without list or watch authority. */
	private async _ReadPod(namespace: string, name: string): Promise<unknown | null>
	{
		try
		{
			return await this.coreApi.readNamespacedPod({ namespace, name });
		}
		catch (error)
		{
			if (_IsK8sNotFound(error))
				return null;
			throw error;
		}
	}
}

/** Derives the v1 name-matched backing Pod and exact Sandbox UID from one assigned resource. */
function _SandboxBackingPod(value: unknown, command: AgentSandboxRuntimePodCommand): _SandboxBackingPod
{
	if (!_Record(value) || value.apiVersion !== `${_AGENT_SANDBOX_API_GROUP}/${_AGENT_SANDBOX_API_VERSION}` || value.kind !== "Sandbox")
		throw new Error(`Agent Sandbox '${command.sandboxId}' has an unexpected resource identity`);
	const metadata = value.metadata;
	if (!_Record(metadata) || metadata.name !== command.sandboxId || metadata.namespace !== command.namespace || !_Identifier(metadata.uid))
		throw new Error(`Agent Sandbox '${command.sandboxId}' has unexpected coordinates`);
	return { podName: command.sandboxId, sandboxUid: metadata.uid };
}

/** Verifies the exact Pod instance, template ServiceAccount, and controlling Sandbox reference. */
function _RuntimePod(value: unknown, command: AgentSandboxRuntimePodCommand, backingPod: _SandboxBackingPod): AgentSandboxRuntimePod
{
	if (!_Record(value))
		throw new Error(`Agent Sandbox Pod '${backingPod.podName}' has an invalid resource shape`);
	const metadata = value.metadata;
	const spec = value.spec;
	if (!_Record(metadata) || !_Record(spec) || metadata.name !== backingPod.podName || metadata.namespace !== command.namespace || !_Identifier(metadata.uid) || spec.serviceAccountName !== command.serviceAccountName || !_HasSandboxOwner(metadata.ownerReferences, command.sandboxId, backingPod.sandboxUid))
		throw new Error(`Agent Sandbox Pod '${backingPod.podName}' does not match its assigned Sandbox identity`);
	return { namespace: command.namespace, serviceAccountName: command.serviceAccountName, podUid: metadata.uid };
}

/** Requires a controller-owned current-version Sandbox owner reference on the backing Pod. */
function _HasSandboxOwner(value: unknown, sandboxId: string, sandboxUid: string): boolean
{
	return Array.isArray(value) && value.some(function _MatchesSandboxOwner(owner: unknown): boolean
	{
		return _Record(owner) && owner.apiVersion === `${_AGENT_SANDBOX_API_GROUP}/${_AGENT_SANDBOX_API_VERSION}` && owner.kind === "Sandbox" && owner.name === sandboxId && owner.uid === sandboxUid && owner.controller === true;
	});
}

/** Narrows untrusted Kubernetes data without accepting arrays as resource records. */
function _Record(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Checks a nonempty Kubernetes UID without normalizing the controller-owned value. */
function _Identifier(value: unknown): value is string
{
	return typeof value === "string" && value.trim().length > 0 && value === value.trim();
}
