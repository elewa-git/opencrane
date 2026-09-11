import type { PersonaFirstChatArchetypes, PersonaFirstChatColours } from "@opencrane/models/user-onboarding";
import type { PersonaColours } from "@opencrane/state/onboarding";

/** Reviewed first-chat content pinned by the clean target baseline. */
export interface LocalDevelopmentBootstrapFixture
{
	/** Local command vocabulary for this fixture. */
	readonly archetype: PersonaFirstChatArchetypes;
	/** Current public first-chat archetype vocabulary. */
	readonly firstChatArchetype: PersonaFirstChatArchetypes;
	/** Current public first-chat colour vocabulary. */
	readonly firstChatColour: PersonaFirstChatColours;
	/** Current persona-onboarding colour vocabulary. */
	readonly personaColour: PersonaColours;
	/** Reviewed owner-visible name. */
	readonly displayName: string;
	/** Immutable baseline content revision. */
	readonly revisionId: string;
	/** Reviewed source path recorded by the target baseline. */
	readonly sourceLabel: string;
	/** SHA-256 digest recorded by the target baseline. */
	readonly digest: string;
	/** Exact reviewed opening text without Markdown quotation markers. */
	readonly opening: string;
	/** Exact three reviewed prompts in their server order. */
	readonly questions: readonly string[];
}
