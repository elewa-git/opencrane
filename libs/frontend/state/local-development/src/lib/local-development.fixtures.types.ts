import type { PersonaFirstChatArchetypes, PersonaFirstChatColours } from "@opencrane/models/user-onboarding";
import type { PersonaColours } from "@opencrane/state/onboarding";

/** Carries the first-chat content copied from the reviewed clean target baseline. */
export interface LocalDevelopmentBootstrapFixture
{
	/** Selects the named local command that uses this fixture. */
	readonly archetype: PersonaFirstChatArchetypes;
	/** Supplies the public archetype sent through the first-chat model. */
	readonly firstChatArchetype: PersonaFirstChatArchetypes;
	/** Supplies the public colour sent through the first-chat model. */
	readonly firstChatColour: PersonaFirstChatColours;
	/** Supplies the colour used by the persona-onboarding model. */
	readonly personaColour: PersonaColours;
	/** Displays the reviewed persona name to the local developer. */
	readonly displayName: string;
	/** Identifies the baseline content revision pinned to the first chat. */
	readonly revisionId: string;
	/** Records the reviewed source path included in the target baseline. */
	readonly sourceLabel: string;
	/** Records the SHA-256 digest included in the target baseline. */
	readonly digest: string;
	/** Preserves the reviewed opening text without Markdown quotation markers. */
	readonly opening: string;
	/** Preserves the three reviewed prompts in server order. */
	readonly questions: readonly string[];
}
