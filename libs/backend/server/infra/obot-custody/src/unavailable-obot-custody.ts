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

/**
 * Custody port used when no Obot is configured: every call fails instead of pretending.
 *
 * There is deliberately no local fallback — OpenCrane cannot hold an integration credential itself,
 * so there is nothing safe to do without Obot. Both methods throw
 * {@link ObotCustodyUnavailableError}, and
 * libs/backend/server/gateways/integrations/main/src/integration-custody-provisioning.ts turns that
 * into a `remote_unavailable` outcome with no custody row written, so an operator sees the
 * integration stay unprovisioned rather than appear ready.
 *
 * Called by: apps/opencrane/src/infra/obot/obot-adapters.factory.ts; asserted against in
 * apps/opencrane/src/infra/obot/__tests__/obot-adapters.factory.test.ts.
 */
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
