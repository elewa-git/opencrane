import type { PersonaFirstChatArchetypes, PersonaFirstChatColours, PersonaColourScores, PersonaColours, PersonaOpennessScores } from "@opencrane/models/user-onboarding";

/** Minimal preference capability accepted by the local archetype resolver. */
export interface LocalDevelopmentArchetypePreferenceStore
{
	/** Read one saved preference. */
	read(key: string): string | null;
	/** Save one selected preference. */
	write(key: string, value: string): boolean;
	/** Remove one invalid preference. */
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
