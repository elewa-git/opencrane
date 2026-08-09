/** Semantic colour treatments available to an initials avatar. */
export enum AvatarTones
{
	/** OpenCrane brand treatment for the signed-in owner or primary agent. */
	Brand = "brand",
	/** Cool blue treatment for a second participant. */
	Blue = "blue",
	/** Green treatment for an available or confirmed participant. */
	Green = "green",
	/** Amber treatment for a participant that needs attention. */
	Amber = "amber",
	/** Quiet treatment when no stronger semantic distinction applies. */
	Neutral = "neutral"
}

/** Finite avatar sizes supported by the shared component. */
export enum AvatarSizes
{
	/** Dense table and chip size. */
	Compact = "compact",
	/** Standard inline participant size. */
	Small = "small",
	/** Default identity size. */
	Medium = "medium",
	/** Prominent journey or conversation identity size. */
	Large = "large"
}
