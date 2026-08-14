import type { ObotCustodyPort } from "@opencrane/backend/server/infra/obot-custody";

import type { IntegrationCustodyLogger, IntegrationCustodyRepository, ProvisionIntegrationCustodyCommand, ProvisionIntegrationCustodyResult } from "./integration-custody-provisioning.types";

/**
 * Hand a credential to Obot for safekeeping, then record the handle Obot returns — and undo the
 * remote side if the local record cannot be written.
 *
 * The order is deliberate. Obot goes first, because only Obot can mint the reference; this process
 * never invents one. Obot's answer is then checked (right catalogue entry, non-blank reference,
 * expiry in the future) and rejected if it is not usable. Only after that is anything written
 * locally. If that local write fails, the remote custody just created is revoked, so a failed
 * provisioning never leaves Obot holding usable custody that no row in this database tracks.
 *
 * The revoke can itself fail. That case returns `compensation_failed` rather than pretending
 * nothing happened, because at that point untracked custody really does exist and an operator has
 * to clean it up.
 *
 * The credential is never written to Postgres, never logged, and never returned. Failure logs
 * carry only the silo, integration, catalogue entry, and the error's class name.
 *
 * Called by: `_CreateIntegrationCustodyRouter`'s `POST /:integrationId/custody` handler in
 * ./integration-custody.router.ts, which apps/opencrane/src/app/routes.ts mounts at
 * `/api/v1/integrations`.
 *
 * @param custody - Obot custody port; the fail-closed adapter when Obot is switched off.
 * @param repository - Local write port, called only after Obot confirms.
 * @param log - Logger for secret-safe failure records.
 * @param command - Silo, integration, catalogue entry, and the write-only credential entries.
 * @returns `provisioned` with the new custody row id, or `unavailable` with the reason — see
 *          `ProvisionIntegrationCustodyResult`, where `compensation_failed` is the only outcome
 *          that needs an operator.
 * @see Obot MCP gateway, pinned to `v0.23.1` by `obot.image.tag` in
 *      apps/_infra/deploy-k8s/values.yaml — NEEDS-HUMAN: add the URI for that release's custody
 *      API once someone confirms the right page.
 */
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

	// 2. Store only the values Obot confirmed — its reference, catalogue entry, and expiry. Postgres
	//    tracks the lifecycle; Obot remains the place the secret actually lives.
	try
	{
		const persisted = await repository.persistReady({ siloId: command.siloId, integrationId: command.integrationId, obotCatalogEntryId: provisioned.obotCatalogEntryId, obotCustodyReference: provisioned.obotCustodyReference, expiresAt: provisioned.expiresAt });
		return { outcome: "provisioned", custodyReferenceId: persisted.custodyReferenceId };
	}
	catch (err)
	{
		// 3. Revoke the custody Obot just created, so a failed local write never leaves Obot holding a credential no row here tracks.
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

/** Log a warning, swallowing any logging error — a broken logger must not change which custody outcome is returned. */
function _Warn(log: IntegrationCustodyLogger, command: ProvisionIntegrationCustodyCommand, err: unknown, message: string): void
{
	try
	{
		log.warn(_FailureLogFields(command, err), message);
	}
	catch { /* Logging is diagnostic only; custody failure handling must remain fail closed. */ }
}

/** Log an error, swallowing any logging error — a broken logger must not change which custody outcome is returned. */
function _Error(log: IntegrationCustodyLogger, command: ProvisionIntegrationCustodyCommand, err: unknown, message: string): void
{
	try
	{
		log.error(_FailureLogFields(command, err), message);
	}
	catch { /* Logging is diagnostic only; custody failure handling must remain fail closed. */ }
}
