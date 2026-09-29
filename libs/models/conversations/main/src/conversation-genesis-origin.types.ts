import type { RoutineFiringTrigger } from "@opencrane/models/agents";

import type { GroupChildOrigin } from "./group-child.types";

/**
 * Identifies the product workflow that created an agent-session conversation history stream.
 *
 * These values are persisted in revision-zero genesis events. They describe provenance only and
 * grant no participant, routine, or parent-conversation authority.
 * Renaming or removing a stored value breaks existing genesis reads.
 */
export enum ConversationGenesisOriginKinds
{
	/** The conversation was admitted from one immutable message in an existing group conversation. */
	GroupChild = "group_child",
	/** The conversation was reserved for one admitted routine firing. */
	RoutineOccurrence = "routine_occurrence",
}

/** Wraps unchanged group-child source coordinates in the closed genesis-origin vocabulary. */
export interface GroupChildConversationGenesisOrigin extends GroupChildOrigin
{
	/** Discriminates group-child provenance from every other genesis origin. */
	readonly kind: ConversationGenesisOriginKinds.GroupChild;
}

/** Binds one occurrence conversation to the exact routine firing that reserved it. */
export interface RoutineOccurrenceConversationGenesisOrigin
{
	/** Discriminates routine-occurrence provenance from every other genesis origin. */
	readonly kind: ConversationGenesisOriginKinds.RoutineOccurrence;
	/** Identifies the stable routine definition. */
	readonly routineId: string;
	/** Selects the immutable routine revision used by this firing. */
	readonly routineRevision: number;
	/** Identifies the single durable firing that owns the occurrence conversation. */
	readonly firingId: string;
	/** Identifies the fixed conversation where the routine was originally configured. */
	readonly destinationConversationId: string;
	/** Records whether a schedule slot or an immediate request selected the firing. */
	readonly trigger: RoutineFiringTrigger;
	/** Records the exact automatic slot; manual firings carry null. */
	readonly scheduledSlot: string | null;
}

/** Closed provenance union accepted by conversation revision-zero genesis events. */
export type ConversationGenesisOrigin = GroupChildConversationGenesisOrigin | RoutineOccurrenceConversationGenesisOrigin;
