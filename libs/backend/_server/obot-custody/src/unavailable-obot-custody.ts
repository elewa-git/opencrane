import type { ObotCustodyPort, ProvisionObotCustodyCommand, ProvisionedObotCustody } from "./obot-custody.types.js";

/** Typed failure emitted when no authenticated Obot management transport is configured. */
export class ObotCustodyUnavailableError extends Error
{
	/** Creates a failure that cannot be mistaken for successful custody provisioning. */
	constructor()
	{
		super("Obot custody authority is unavailable");
		this.name = "ObotCustodyUnavailableError";
	}
}

/** Fail-closed adapter used until an authenticated Obot API contract is verified. */
export class __UnavailableObotCustodyAdapter implements ObotCustodyPort
{
	/** Rejects provisioning rather than minting a local custody handle. */
	async provision(_command: ProvisionObotCustodyCommand): Promise<ProvisionedObotCustody>
	{
		throw new ObotCustodyUnavailableError();
	}

	/** Rejects revocation because no remote authority can be contacted. */
	async revoke(_obotCustodyReference: string): Promise<void>
	{
		throw new ObotCustodyUnavailableError();
	}
}
