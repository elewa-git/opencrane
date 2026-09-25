/** Conceals unavailable or unauthorized selected-resource coordinates. */
export class PersonalAgentToolsDenied extends Error
{
	public constructor() { super("Personal agent tool selection was not authorized or available"); }
}

/** Requires a fresh read after the active revision changes. */
export class PersonalAgentToolsConflict extends Error
{
	public constructor() { super("Personal agent active revision changed"); }
}

/** Reports that the caller has no unique active published personal agent. */
export class PersonalAgentToolsUnavailable extends Error
{
	public constructor() { super("Personal agent is unavailable"); }
}
