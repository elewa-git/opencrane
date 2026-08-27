import { AG_UI_RUN_WAIT_STATE_EVENT, AgUiRunWaitOperations, AgUiRunWaitReasons, AgUiRunWaitSources, type AgUiRunWaitStateEnvelope } from "@opencrane/contracts";

import { _BoundedIdentifier } from "../bounded-value.validator";

/** Closed reason set accepted from the versioned server projection. */
const _REASONS = new Set<string>(Object.values(AgUiRunWaitReasons));

/** Closed source set accepted from the versioned server projection. */
const _SOURCES = new Set<string>(Object.values(AgUiRunWaitSources));

/** Closed mutation set accepted from the versioned server projection. */
const _OPERATIONS = new Set<string>(Object.values(AgUiRunWaitOperations));

/** Validate the wait envelope and the authority-specific reason restrictions. */
export function _IsRunWaitState(value: unknown): value is AgUiRunWaitStateEnvelope
{
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return false;
	const candidate = value as Record<string, unknown>;
	if (Object.keys(candidate).some(function _Unknown(key) { return key !== "version" && key !== "runId" && key !== "source" && key !== "operation" && key !== "waits"; }))
		return false;
	if (candidate["version"] !== AG_UI_RUN_WAIT_STATE_EVENT || !_BoundedIdentifier(candidate["runId"]))
		return false;
	if (typeof candidate["source"] !== "string" || !_SOURCES.has(candidate["source"]))
		return false;
	if (typeof candidate["operation"] !== "string" || !_OPERATIONS.has(candidate["operation"]))
		return false;
	if (!Array.isArray(candidate["waits"]) || candidate["waits"].length > 256)
		return false;
	if (candidate["operation"] !== AgUiRunWaitOperations.Replace && candidate["waits"].length === 0)
		return false;
	const ids = new Set<string>();
	for (const wait of candidate["waits"])
	{
		if (!_IsWait(wait, candidate["source"] as AgUiRunWaitSources) || ids.has(wait.id))
			return false;
		ids.add(wait.id);
	}
	return true;
}

/** Validate one wait and prevent one source from claiming another source's reason. */
function _IsWait(value: unknown, source: AgUiRunWaitSources): value is AgUiRunWaitStateEnvelope["waits"][number]
{
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return false;
	const candidate = value as Record<string, unknown>;
	if (Object.keys(candidate).some(function _Unknown(key) { return key !== "id" && key !== "reason"; }))
		return false;
	if (!_BoundedIdentifier(candidate["id"]) || typeof candidate["reason"] !== "string" || !_REASONS.has(candidate["reason"]))
		return false;
	if (source === AgUiRunWaitSources.Runtime)
		return candidate["reason"] === AgUiRunWaitReasons.ExternalAction;
	if (source === AgUiRunWaitSources.Recovery)
		return candidate["reason"] === AgUiRunWaitReasons.RecoveryRequired;
	return candidate["reason"] === AgUiRunWaitReasons.ParticipantInput || candidate["reason"] === AgUiRunWaitReasons.Approval || candidate["reason"] === AgUiRunWaitReasons.PersonalMemoryPermission;
}
