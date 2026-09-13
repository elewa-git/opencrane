/** A personal-agent comparison lost; the owning transaction must roll back before retrying. */
export class PersonalAgentBootstrapConflict extends Error
{
	/** Describe the lost comparison without exposing user or deployment coordinates. */
	constructor()
	{
		super("unused personal agent profile repair lost its source comparison");
		this.name = PersonalAgentBootstrapConflict.name;
	}
}
