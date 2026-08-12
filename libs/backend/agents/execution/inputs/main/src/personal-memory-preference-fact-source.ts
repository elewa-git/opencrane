import { __SelectPersonalPreferenceFactIds, type PersonalMemoryAdmissionRepository } from "@opencrane/backend/agents/personal/memory";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { RunInputSnapshotIdentityKinds } from "@opencrane/contracts";
import { AgentServiceKinds } from "@opencrane/models/agents";

import type { IdentityEnvelopeInput, PreferenceFactInput, PreferenceFactSource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types.js";

/**
 * Freezes the ids of the user's consented preference facts, chosen from the verified run identity.
 *
 * Ids only — preference text never reaches the snapshot or Postgres, so the run carries a pointer
 * to what the user agreed to rather than a copy of it. Refuses managed runs and non-user
 * identities, so a personal preference can never reach a managed run.
 *
 * Constructed by: `__CreatePrismaPersonalSessionAssemblyAuthorities`
 * (prisma-session-assembly-authorities.ts). Managed admission substitutes an inline empty source.
 *
 * @implements PreferenceFactSource
 */
export class PersonalMemoryPreferenceFactSource implements PreferenceFactSource
{
	/** Makes the reader that selects the user's preference facts from the product database. */
	private readonly createPersonalMemory: (transaction: RunAdmissionTransaction) => PersonalMemoryAdmissionRepository;

	/** Creates the source over the injected personal-memory admission authority. */
	constructor(createPersonalMemory: (transaction: RunAdmissionTransaction) => PersonalMemoryAdmissionRepository)
	{
		this.createPersonalMemory = createPersonalMemory;
	}

	/** Loads ids only, never preference text. The snapshot keeps just the ids chosen at admission. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, identity: IdentityEnvelopeInput, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<readonly PreferenceFactInput[]>>
	{
		// 1. Refuse managed or non-user identities, so a personal preference can never reach a managed run.
		if (run.agentKind !== AgentServiceKinds.Personal || identity.kind !== RunInputSnapshotIdentityKinds.User)
		{
			return { outcome: "denied", reason: "memory_scope_unavailable" };
		}

		// 2. Read only the verified subject's consented facts, through the caller's admission transaction.
		const ids = await __SelectPersonalPreferenceFactIds(this.createPersonalMemory(transaction), {
			siloId: command.siloId,
			organizationId: identity.organizationId,
			subjectId: identity.executionSubjectId,
		});

		// 3. Pass the ids on for snapshot compilation. The fact text stays with the memory gateway.
		return { outcome: "loaded", value: ids.map(function _toPreferenceFact(id): PreferenceFactInput { return { id }; }) };
	}
}
