import type { PersonaAgentRevisionSelectionPort } from "../approval/persona-authority.types";

/** App-owned factory that binds persona approval to agent-service revision selection. */
export interface PersonaAgentRevisionSelectionFactory<Transaction = unknown>
{
	/** Creates the narrow selection port over the persona unit of work's transaction. */
	create(transaction: Transaction): PersonaAgentRevisionSelectionPort;
}
