import { __SelectPersonalPreferenceFactIds, type PersonalMemoryAdmissionRepository } from "@opencrane/backend/agents/personal/memory";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { RunInputSnapshotIdentityKinds } from "@opencrane/contracts";
import { AgentServiceKinds } from "@opencrane/models/agents";

import type { IdentityEnvelopeInput, PreferenceFactInput, PreferenceFactSource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types.js";

/** Freezes only explicit, consented personal preference coordinates selected from verified run identity. */
export class PersonalMemoryPreferenceFactSource implements PreferenceFactSource
{
	/** Product-database authority for exact personal preference selection. */
	private readonly personalMemory: PersonalMemoryAdmissionRepository;

	/** Creates the source over the injected personal-memory admission authority. */
	constructor(personalMemory: PersonalMemoryAdmissionRepository)
	{
		this.personalMemory = personalMemory;
	}

	/** Loads no preference text; the run snapshot retains only catalog identifiers selected at admission. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, identity: IdentityEnvelopeInput, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<readonly PreferenceFactInput[]>>
	{
		// 1. Refuse managed or non-user identities so no personal preference coordinate can cross the run-kind boundary.
		if (run.agentKind !== AgentServiceKinds.Personal || identity.kind !== RunInputSnapshotIdentityKinds.User)
		{
			return { outcome: "denied", reason: "memory_scope_unavailable" };
		}

		// 2. Select only the verified subject's consented metadata through the caller-owned admission transaction.
		const ids = await __SelectPersonalPreferenceFactIds(this.personalMemory, transaction, {
			siloId: command.siloId,
			organizationId: identity.organizationId,
			subjectId: identity.executionSubjectId,
		});

		// 3. Preserve the content-free identifiers for snapshot compilation; durable fact content remains gateway-only.
		return { outcome: "loaded", value: ids.map(function _toPreferenceFact(id): PreferenceFactInput { return { id }; }) };
	}
}
