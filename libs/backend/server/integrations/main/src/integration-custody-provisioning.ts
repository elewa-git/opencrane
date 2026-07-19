import type { ObotCustodyPort } from "@opencrane/server/_infra/obot-custody";

import type { IntegrationCustodyRepository, ProvisionIntegrationCustodyCommand, ProvisionIntegrationCustodyResult } from "./integration-custody-provisioning.types.js";

/** Provisions remote Obot custody and compensates if its product projection cannot persist. */
export async function __ProvisionIntegrationCustody(custody: ObotCustodyPort, repository: IntegrationCustodyRepository, command: ProvisionIntegrationCustodyCommand): Promise<ProvisionIntegrationCustodyResult>
{
	// 1. Obtain the opaque custody reference from Obot; this process never invents one.
	let provisioned;
	try { provisioned = await custody.provision(command); }
	catch { return { outcome: "unavailable", reason: "remote_unavailable" }; }
	if (provisioned.obotCatalogEntryId !== command.obotCatalogEntryId || !provisioned.obotCustodyReference.trim() || provisioned.expiresAt <= new Date())
	{
		try { await custody.revoke(provisioned.obotCustodyReference); }
		catch { return { outcome: "unavailable", reason: "compensation_failed" }; }
		return { outcome: "unavailable", reason: "remote_unavailable" };
	}

	// 2. Persist only Obot-confirmed coordinates, preserving Postgres as a lifecycle projection.
	try
	{
		const persisted = await repository.persistReady({ siloId: command.siloId, integrationId: command.integrationId, obotCatalogEntryId: provisioned.obotCatalogEntryId, obotCustodyReference: provisioned.obotCustodyReference, expiresAt: provisioned.expiresAt });
		return { outcome: "provisioned", custodyReferenceId: persisted.custodyReferenceId };
	}
	catch
	{
		// 3. Revoke the remote result so a persistence failure never leaves usable untracked custody.
		try { await custody.revoke(provisioned.obotCustodyReference); return { outcome: "unavailable", reason: "persistence_failed" }; }
		catch { return { outcome: "unavailable", reason: "compensation_failed" }; }
	}
}
