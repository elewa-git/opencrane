/** Finite archetype colours supported by the persona summary. */
export enum PersonaArchetypeTones
{
	/** Direct, decisive Commander treatment. */
	Commander = "commander",
	/** Energetic, exploratory Catalyst treatment. */
	Catalyst = "catalyst",
	/** Calm, supportive Anchor treatment. */
	Anchor = "anchor",
	/** Evidence-led, methodical Analyst treatment. */
	Analyst = "analyst"
}

/** One presentation-only score in a reviewed persona result. */
export interface PersonaArchetypeScore
{
	/** Stable identifier used to track the score row. */
	readonly id: string;
	/** Human-readable archetype label. */
	readonly label: string;
	/** Rounded display percentage between zero and one hundred. */
	readonly percentage: number;
	/** Approved archetype colour treatment. */
	readonly tone: PersonaArchetypeTones;
}
