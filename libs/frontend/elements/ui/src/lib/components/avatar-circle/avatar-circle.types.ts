/**
 * The colour an initials avatar uses, chosen by who or what it represents.
 *
 * A fixed set rather than a colour input, so an avatar can never be given an off-palette colour.
 */
export enum AvatarTones
{
	/** Brand colour, for the signed-in user or the primary agent. */
	Brand = "brand",
	/** Cool blue treatment for a second participant. */
	Blue = "blue",
	/** Green treatment for an available or confirmed participant. */
	Green = "green",
	/** Amber treatment for a participant that needs attention. */
	Amber = "amber",
	/** Neutral grey, when nothing more specific applies. */
	Neutral = "neutral"
}

/**
 * The four avatar sizes, from dense table rows up to a journey header.
 *
 * A fixed set rather than a pixel input, so avatars stay consistent across screens.
 */
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
