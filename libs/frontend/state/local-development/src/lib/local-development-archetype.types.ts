import type { PersonaFirstChatArchetypes, PersonaFirstChatColours, PersonaColourScores, PersonaColours, PersonaOpennessScores } from "@opencrane/models/user-onboarding";

/**
 * Gives the local archetype resolver the preference operations it needs without depending on a
 * browser storage implementation.
 *
 * Implementations translate storage failures into null reads or false writes, and removals do not
 * throw. This lets the resolver use an explicit selection for the current lifecycle even when it
 * cannot persist it, or fall back to Commander after discarding an invalid saved value.
 *
 * Called by: {@link __ResolveLocalDevelopmentArchetype}. The application supplies the structurally
 * compatible `PlatformPreferenceStore` selected by its active shell.
 */
export interface LocalDevelopmentArchetypePreferenceStore
{
	/**
	 * Reads a saved preference without throwing when storage is unavailable.
	 *
	 * @param key - Preference key requested by the resolver.
	 * @returns The saved value, or null when it is absent or cannot be read.
	 */
	read(key: string): string | null;
	/**
	 * Attempts to retain an explicit selection for future application lifecycles.
	 *
	 * @param key - Preference key owned by the resolver.
	 * @param value - Supported archetype selected explicitly for this lifecycle.
	 * @returns Whether persistence succeeded; false does not invalidate the current selection.
	 */
	write(key: string, value: string): boolean;
	/**
	 * Removes a non-empty value that the resolver no longer recognizes without throwing.
	 *
	 * @param key - Preference key whose saved value is invalid.
	 */
	remove(key: string): void;
}

/** Reviewed first-chat material pinned to one local archetype fixture. */
export interface LocalDevelopmentFirstChatFixture
{
	/** Stable content revision identity from the clean database baseline. */
	readonly id: string;
	/** Digest of the reviewed bootstrap source. */
	readonly digest: string;
	/** Reviewed source path. */
	readonly sourceLabel: string;
	/** Exact reviewed opening. */
	readonly opening: string;
	/** Exact reviewed calibration prompts in order. */
	readonly questions: readonly string[];
}

/** Coherent local survey, persona, and first-chat fixture for one primary archetype. */
export interface LocalDevelopmentArchetypeFixture
{
	/** Stable archetype used by the first-chat projection. */
	readonly archetype: PersonaFirstChatArchetypes;
	/** Guardian persona name displayed by onboarding and conversations. */
	readonly displayName: string;
	/** Primary persona colour in the onboarding projection. */
	readonly primaryColour: PersonaColours;
	/** Primary first-chat colour in the bootstrap projection. */
	readonly firstChatColour: PersonaFirstChatColours;
	/** Secondary colour produced by this reviewed answer path. */
	readonly secondaryColour: PersonaColours;
	/** Reviewed answer identifier for every survey question. */
	readonly answerChoiceIds: Readonly<Record<string, string>>;
	/** Fixed score evidence produced by the reviewed answer path. */
	readonly colourScores: PersonaColourScores;
	/** Fixed Guardian score evidence produced by the reviewed answer path. */
	readonly opennessScores: PersonaOpennessScores;
	/** Compiled Guardian instructions for the reviewed answer path. */
	readonly instructionPreview: string;
	/** Reviewed first-chat material selected after persona approval. */
	readonly firstChat: LocalDevelopmentFirstChatFixture;
}
