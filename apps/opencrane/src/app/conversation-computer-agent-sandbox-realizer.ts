import type * as k8s from "@kubernetes/client-node";

import { ConversationComputerRealizationKinds, type AgentSandboxConversationComputerRealization, type ConversationComputerRealization } from "@opencrane/contracts";
import type { ConversationComputerProcessAuthenticator, ConversationComputerProcessIdentity, ConversationComputerRealizationClaimCommand, ConversationComputerRealizationCommand, ConversationComputerRealizationRenewCommand, ConversationComputerRealizer } from "@opencrane/backend/server/conversations";
import { AgentSandboxClaimAdapter, AgentSandboxPodBindingAdapter } from "@opencrane/backend/server/infra/agent-sandbox";
import type { RuntimeTokenReviewer } from "@opencrane/backend/server/infra/workload-identity";

import type { AgentSandboxReleaseProfileConfig } from "./config.types";

/** Adapts production Agent Sandbox resources to the neutral conversation-computer realizer port. */
export class AgentSandboxConversationComputerRealizer implements ConversationComputerRealizer
{
	/** Owns the SandboxClaim writes for this release profile. */
	private readonly claims: AgentSandboxClaimAdapter;
	/** Owns the Kubernetes reads that bind a reviewed Pod to its claim. */
	private readonly pods: AgentSandboxPodBindingAdapter;

	/** Connect the release profile to the Kubernetes APIs used by activation and binding. */
	public constructor(private readonly customApi: k8s.CustomObjectsApi, coreApi: k8s.CoreV1Api, private readonly profile: AgentSandboxReleaseProfileConfig)
	{
		this.claims = new AgentSandboxClaimAdapter(customApi);
		this.pods = new AgentSandboxPodBindingAdapter(coreApi, customApi);
	}

	/** Derive the deterministic pending claim recorded before Kubernetes mutation. */
	public prepare(command: Omit<ConversationComputerRealizationClaimCommand, "realization">): ConversationComputerRealization
	{
		return { kind: ConversationComputerRealizationKinds.AgentSandbox, claimId: `${command.computerId}-g${command.generation}`, sandboxId: null, serviceFQDN: null };
	}

	/** Create or observe the exact claim and return its current controller coordinates. */
	public async claim(command: ConversationComputerRealizationClaimCommand): Promise<ConversationComputerRealization>
	{
		const realization = this._AgentSandbox(command.realization);
		const claim = await this.claims.claim({ siloId: command.siloId, computerId: command.computerId, leaseId: command.leaseId, generation: command.generation, namespace: this.profile.namespace, profileName: this.profile.profileName, warmPoolName: this.profile.warmPoolName, expiresAt: command.expiresAt, reason: command.reason });
		if (claim.claimId !== realization.claimId)
			throw new Error("Agent Sandbox returned a different conversation-computer claim");
		return { ...realization, sandboxId: claim.sandboxId, serviceFQDN: claim.serviceFQDN };
	}

	/** Read the exact claim selected by the persisted realization. */
	public async inspect(command: ConversationComputerRealizationCommand)
	{
		const realization = this._AgentSandbox(command.lease.realization);
		const status = await this.claims.inspect(this._ClaimCommand(command, realization));
		return status === null ? null : { shutdownTime: status.shutdownTime };
	}

	/** Extend the exact claim selected by the persisted realization. */
	public renew(command: ConversationComputerRealizationRenewCommand): Promise<"renewed" | "absent">
	{
		const realization = this._AgentSandbox(command.lease.realization);
		return this.claims.renew({ ...this._ClaimCommand(command, realization), expiresAt: command.expiresAt });
	}

	/** Delete the exact claim selected by the persisted realization. */
	public release(command: ConversationComputerRealizationCommand): Promise<"released" | "absent">
	{
		const realization = this._AgentSandbox(command.lease.realization);
		return this.claims.release(this._ClaimCommand(command, realization));
	}

	/** Bind only a TokenReviewed Pod whose claim and labels match the persisted realization. */
	public async bind(command: ConversationComputerRealizationCommand & { readonly process: ConversationComputerProcessIdentity }): Promise<boolean>
	{
		if (command.process.kind !== ConversationComputerRealizationKinds.AgentSandbox)
			return false;
		const realization = this._AgentSandbox(command.lease.realization);
		return this.pods.verify({ computerId: command.computerId, lease: command.lease, realization, workload: command.process.workload });
	}

	/** Refuse a host-process realization at the production Kubernetes adapter. */
	private _AgentSandbox(realization: ConversationComputerRealization): AgentSandboxConversationComputerRealization
	{
		if (realization.kind !== ConversationComputerRealizationKinds.AgentSandbox)
			throw new Error("Agent Sandbox adapter requires an Agent Sandbox realization");
		return realization;
	}

	/** Map neutral lease coordinates to the exact SandboxClaim operation. */
	private _ClaimCommand(command: ConversationComputerRealizationCommand, realization: AgentSandboxConversationComputerRealization)
	{
		return { namespace: this.profile.namespace, claimId: realization.claimId, computerId: command.computerId, leaseId: command.lease.leaseId, generation: command.lease.leaseGeneration };
	}
}

/** Wraps Kubernetes TokenReview as a production conversation-computer process authenticator. */
export class KubernetesConversationComputerProcessAuthenticator implements ConversationComputerProcessAuthenticator
{
	/** Retain the audience, namespace and ServiceAccount-bound reviewer. */
	public constructor(private readonly reviewer: RuntimeTokenReviewer) {}

	/** Return a process identity only after Kubernetes accepts the projected token. */
	public async authenticate(bearer: string)
	{
		const workload = await this.reviewer.__Review(bearer);
		return workload === null ? null : { kind: ConversationComputerRealizationKinds.AgentSandbox as const, workload };
	}
}
