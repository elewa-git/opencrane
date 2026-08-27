import { AgUiRunWaitOperations, AgUiRunWaitReasons, AgUiRunWaitSources, type AgUiRunWaitStateEnvelope } from "@opencrane/contracts";

import type { AgUiStreamState } from "../ag-ui-stream.types";
import { AgUiRunStatuses, type AgUiRunWaitView } from "./run.types";
import { _IsRunWaitState } from "./run-wait.validator";

/** Stable display order prevents event arrival order from changing the visible categories. */
const _REASON_ORDER: readonly AgUiRunWaitReasons[] = [AgUiRunWaitReasons.ExternalAction, AgUiRunWaitReasons.ParticipantInput, AgUiRunWaitReasons.Approval, AgUiRunWaitReasons.PersonalMemoryPermission, AgUiRunWaitReasons.RecoveryRequired];

/** Apply one strict wait mutation without inferring approval from an outside action. */
export function _RunWaitState(state: AgUiStreamState, value: unknown, name: string): AgUiStreamState
{
	if (!_IsRunWaitState(value))
		throw new Error("AG-UI run wait state is invalid");
	if (state.runId === null || state.runId !== value.runId)
		throw new Error("AG-UI run wait state does not match the active run");
	const waits = _ApplyWaits(state.runWaits, value);
	const runWaitReasons = _REASON_ORDER.filter(function _Present(reason) { return [...waits.values()].some(function _Matches(wait) { return wait.reason === reason; }); });
	const runStatus = runWaitReasons.length === 0 && state.runStatus === AgUiRunStatuses.Interrupted ? AgUiRunStatuses.Running : state.runStatus;
	return { ...state, runStatus, runWaits: waits, runWaitReasons, customEvents: [...state.customEvents, name] };
}

/** Clear the complete participant-owned subset when the server sends an empty overlay marker. */
export function _ClearParticipantWaits(state: AgUiStreamState): AgUiStreamState
{
	const waits = new Map([...state.runWaits].filter(function _OtherSource(entry) { return entry[1].source !== AgUiRunWaitSources.Participant; }));
	const runWaitReasons = _REASON_ORDER.filter(function _Present(reason) { return [...waits.values()].some(function _Matches(wait) { return wait.reason === reason; }); });
	const runStatus = runWaitReasons.length === 0 && state.runStatus === AgUiRunStatuses.Interrupted ? AgUiRunStatuses.Running : state.runStatus;
	return { ...state, runStatus, runWaits: waits, runWaitReasons };
}

/** Apply one source-scoped add, remove, or replacement operation. */
function _ApplyWaits(current: ReadonlyMap<string, AgUiRunWaitView>, envelope: AgUiRunWaitStateEnvelope): ReadonlyMap<string, AgUiRunWaitView>
{
	const waits = new Map(current);
	if (envelope.operation === AgUiRunWaitOperations.Replace)
	{
		for (const [key, wait] of waits)
		{
			if (wait.source === envelope.source)
				waits.delete(key);
		}
	}
	for (const wait of envelope.waits)
	{
		const key = `${envelope.source}:${wait.id}`;
		if (envelope.operation === AgUiRunWaitOperations.Remove)
			waits.delete(key);
		else waits.set(key, { ...wait, source: envelope.source });
	}
	return waits;
}
