import type { ObotCustodyPort } from "@opencrane/server/_infra/obot-custody";

import type { IntegrationCustodyLogger, IntegrationCustodyRepository, ProvisionIntegrationCustodyCommand, ProvisionIntegrationCustodyResult } from "./integration-custody-provisioning.types.js";

/** Provisions remote Obot custody and compensates if its product projection cannot persist. */
export async function __ProvisionIntegrationCustody(custody: ObotCustodyPort, repository: IntegrationCustodyRepository, log: IntegrationCustodyLogger, command: ProvisionIntegrationCustodyCommand): Promise<ProvisionIntegrationCustodyResult>
{
	// 1. Obtain the opaque custody reference from Obot; this process never invents one.
	let provisioned;
	try
	{
		provisioned = await custody.provision(command);
	}
	catch (err)
	{
		_Warn(log, command, err, "Obot custody provisioning failed");
		return { outcome: "unavailable", reason: "remote_unavailable" };
	}
	if (provisioned.obotCatalogEntryId !== command.obotCatalogEntryId || !provisioned.obotCustodyReference.trim() || provisioned.expiresAt <= new Date())
	{
		try
		{
			await custody.revoke(provisioned.obotCustodyReference);
		}
		catch (err)
		{
			_Error(log, command, err, "Obot custody compensation failed after an invalid response");
			return { outcome: "unavailable", reason: "compensation_failed" };
		}
		return { outcome: "unavailable", reason: "remote_unavailable" };
	}

	// 2. Persist only Obot-confirmed coordinates, preserving Postgres as a lifecycle projection.
	try
	{
		const persisted = await repository.persistReady({ siloId: command.siloId, integrationId: command.integrationId, obotCatalogEntryId: provisioned.obotCatalogEntryId, obotCustodyReference: provisioned.obotCustodyReference, expiresAt: provisioned.expiresAt });
		return { outcome: "provisioned", custodyReferenceId: persisted.custodyReferenceId };
	}
	catch (err)
	{
		// 3. Revoke the remote result so a persistence failure never leaves usable untracked custody.
		_Warn(log, command, err, "Integration custody persistence failed; starting compensation");
		try
		{
			await custody.revoke(provisioned.obotCustodyReference);
			return { outcome: "unavailable", reason: "persistence_failed" };
		}
		catch (compensationError)
		{
			_Error(log, command, compensationError, "Obot custody compensation failed after a persistence failure");
			return { outcome: "unavailable", reason: "compensation_failed" };
		}
	}
}

/**
 * Build a secret-safe failure record for custody operations.
 * @param command - Non-secret identifiers for the failed operation.
 * @param err - Original error, classified without serialising its untrusted message or payload.
 * @returns Stable fields safe for structured logs.
 */
function _FailureLogFields(command: ProvisionIntegrationCustodyCommand, err: unknown): Record<string, string>
{
	return {
		siloId: command.siloId,
		integrationId: command.integrationId,
		obotCatalogEntryId: command.obotCatalogEntryId,
		errorType: err instanceof Error ? err.constructor.name : typeof err,
	};
}

/** Emits a warning without allowing observability failures to change the fail-closed custody result. */
function _Warn(log: IntegrationCustodyLogger, command: ProvisionIntegrationCustodyCommand, err: unknown, message: string): void
{
	try
	{
		log.warn(_FailureLogFields(command, err), message);
	}
	catch { /* Logging is diagnostic only; custody failure handling must remain fail closed. */ }
}

/** Emits an error without allowing observability failures to change the fail-closed custody result. */
function _Error(log: IntegrationCustodyLogger, command: ProvisionIntegrationCustodyCommand, err: unknown, message: string): void
{
	try
	{
		log.error(_FailureLogFields(command, err), message);
	}
	catch { /* Logging is diagnostic only; custody failure handling must remain fail closed. */ }
}
