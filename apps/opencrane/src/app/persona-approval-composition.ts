import type { Prisma } from "@prisma/client";

import { AgentRevisionPersonaSelectionMaterializationCodes, PrismaAgentRevisionPersonaSelectionRepository } from "@opencrane/backend/server/agents/agent-services";
import { PersonaAgentRevisionSelectionStatuses, type PersonaAgentRevisionSelectionFactory, type PersonaAgentRevisionSelectionPort, type SelectApprovedPersonaForPersonalAgentCommand, type SelectApprovedPersonaForPersonalAgentResult } from "@opencrane/backend/agents/personal/personas";

/** Adapts the agent-service strategy to the narrow port owned by persona approval. */
class _PersonaAgentRevisionSelectionAdapter implements PersonaAgentRevisionSelectionPort
{
	/** Agent-service strategy bound to the persona approval transaction. */
	private readonly strategy: PrismaAgentRevisionPersonaSelectionRepository;

	/** Creates the adapter without taking ownership of the transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.strategy = new PrismaAgentRevisionPersonaSelectionRepository(transaction);
	}

	/** Selects the approved persona or maps the agent-service result to a persona approval outcome. */
	async select(command: SelectApprovedPersonaForPersonalAgentCommand): Promise<SelectApprovedPersonaForPersonalAgentResult>
	{
		const result = await this.strategy.materializeForOwner({
			siloId: command.siloId,
			subjectId: command.userId,
			targetPersonaRevisionId: command.personaRevisionId,
			authoredBy: command.userId,
			materializedAt: command.selectedAt,
			changeMessage: `Selected approved persona revision ${command.personaRevisionId}.`,
		});
		switch (result.status)
		{
			case AgentRevisionPersonaSelectionMaterializationCodes.Materialized:
			case AgentRevisionPersonaSelectionMaterializationCodes.AlreadyCurrent:
				return { status: PersonaAgentRevisionSelectionStatuses.Selected };
			case AgentRevisionPersonaSelectionMaterializationCodes.NotApplicable:
				return { status: PersonaAgentRevisionSelectionStatuses.NotApplicable };
			case AgentRevisionPersonaSelectionMaterializationCodes.StaleSource:
			case AgentRevisionPersonaSelectionMaterializationCodes.Unavailable:
				return { status: PersonaAgentRevisionSelectionStatuses.Conflict };
		}
	}
}

/** Builds the app-owned cross-domain bridge for each persona approval transaction. */
export function _CreatePersonaAgentRevisionSelectionFactory(): PersonaAgentRevisionSelectionFactory<Prisma.TransactionClient>
{
	return {
		create(transaction: Prisma.TransactionClient): PersonaAgentRevisionSelectionPort
		{
			return new _PersonaAgentRevisionSelectionAdapter(transaction);
		},
	};
}
