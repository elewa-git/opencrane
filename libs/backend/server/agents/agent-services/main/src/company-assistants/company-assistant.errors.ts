/** Stops provisioning without exposing the administrator's grants or other members' identities. */
export class CompanyAssistantProvisioningDenied extends Error
{
	/** Supplies one rollback error for invalid choices or refused authority. */
	public constructor() { super("Company assistant provisioning was not authorized or available"); }
}

/** Requires a fresh selection read after the active revision changes. */
export class CompanyAssistantToolsConflict extends Error
{
	/** Rejects stale edits without suggesting that replacement choices were committed. */
	public constructor() { super("Company assistant active revision changed"); }
}

/** Conceals unavailable company service coordinates after administrator authorization. */
export class CompanyAssistantToolsUnavailable extends Error
{
	/** Reports that no active published company assistant can be edited. */
	public constructor() { super("Company assistant is unavailable"); }
}

