import { EventType } from "@ag-ui/core";
import type { AgUiProjectionEvent } from "@opencrane/contracts";

import type { AgUiStreamState } from "../ag-ui-stream.types";
import { AgUiRunStatuses } from "./run.types";

/** Start a new run, clearing any prior terminal, recovery, and interrupt state. */
export function _StartRun(state: AgUiStreamState, runId: string): AgUiStreamState
{
	return { ...state, runId, runStatus: AgUiRunStatuses.Running, runFailure: null, runRecovery: null, interrupts: [], accessRevoked: false };
}

/** Mark the run failed, or cancelled when the code is RUN_CANCELLED, keeping only the message and code. */
export function _FailRun(state: AgUiStreamState, message: string, code: string | undefined): AgUiStreamState
{
	const runStatus = code === "RUN_CANCELLED" ? AgUiRunStatuses.Cancelled : AgUiRunStatuses.Failed;
	return { ...state, runStatus, runFailure: { message, ...(code === undefined ? {} : { code }) }, interrupts: [] };
}

/** Finish the run as succeeded, or interrupted when the outcome asks for input; never overwrite a failure. */
export function _FinishRun(state: AgUiStreamState, event: Extract<AgUiProjectionEvent, { readonly type: EventType.RUN_FINISHED }>): AgUiStreamState
{
	if (state.runId !== null && state.runId !== event.runId) throw new Error("AG-UI run terminal does not match the active run");
	if (state.runStatus === AgUiRunStatuses.NeedsRecovery || state.runStatus === AgUiRunStatuses.Failed || state.runStatus === AgUiRunStatuses.Cancelled) throw new Error("AG-UI success cannot overwrite a recovery-required, failed, or cancelled run");
	if (event.outcome?.type === "interrupt") return { ...state, runId: event.runId, runStatus: AgUiRunStatuses.Interrupted, runFailure: null, interrupts: event.outcome.interrupts };
	return { ...state, runId: event.runId, runStatus: AgUiRunStatuses.Succeeded, runFailure: null, interrupts: [] };
}
