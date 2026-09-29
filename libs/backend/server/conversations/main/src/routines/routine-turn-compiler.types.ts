import type { RoutineRunAdmissionDependencies } from "./routine-run-admission.types";
import type { ConversationComputerTurnCandidate, ConversationComputerTurnCompileCommand, ConversationComputerTurnHistoryAnchor } from "../computers/turns/conversation-computer-turn.types";

/**
 * Selects the owner of a turn in a routine-origin conversation. These values are in-memory only.
 * A null routine candidate must never become permission to try interactive admission instead.
 */
export enum RoutineTurnDispatchKinds
{
	/** The first instruction still owns this turn, whether or not it can currently execute. */
	Routine = "routine",
	/** A verified first answer allows a later real human message to use ordinary admission. */
	Interactive = "interactive",
}

/** Carries a candidate only when the selected initial routine turn is ready to execute. */
export interface RoutineTurnDispatchResult
{
	/** Distinguishes initial routine recovery from a subsequent human conversation turn. */
	readonly kind: RoutineTurnDispatchKinds;
	/** Present only for a ready Routine result; absence never permits fallback. */
	readonly candidate?: ConversationComputerTurnCandidate;
}

/** Validates the initial attested instruction before handing any follow-up to ordinary admission. */
export interface RoutineTurnDispatcher
{
	/** Selects the initial run or a later human turn without interpreting failed recovery as fallback. */
	dispatch(command: ConversationComputerTurnCompileCommand, anchor?: ConversationComputerTurnHistoryAnchor): Promise<RoutineTurnDispatchResult>;
}

/** Read and authorization owners for an already-admitted routine; no workflow spawn port exists. */
export interface RoutineTurnCompilerDependencies extends Pick<RoutineRunAdmissionDependencies, "routines" | "occurrences" | "history" | "cipher" | "membership">
{
	/** Maximum per-turn credential spend selected by deployment, also bounded by admitted run policy. */
	readonly maximumTurnCostUsdMicros: number;
}
