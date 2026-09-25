import { describe, expect, it } from "vitest";

import { RoutineFiringTrigger } from "@opencrane/models/agents";

import { ConversationGenesisOriginKinds } from "../conversation-genesis-origin.types";
import { ___ParseConversationGenesisOrigin } from "../conversation-genesis-origin.validator";

/** Stable group-child origin used to isolate closed-union validation cases. */
const _GROUP_CHILD = { kind: ConversationGenesisOriginKinds.GroupChild, requestId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", parentConversationId: "parent-1", parentMessageId: "41c1f1dc-0010-4f13-9c2f-d3841ffd6651", parentMessagePosition: "3" } as const;
/** Stable automatic routine origin used to isolate trigger-specific validation cases. */
const _AUTOMATIC = { kind: ConversationGenesisOriginKinds.RoutineOccurrence, routineId: "routine-1", routineRevision: 3, firingId: "firing-1", destinationConversationId: "destination-1", trigger: RoutineFiringTrigger.Automatic, scheduledSlot: "2026-09-25T10:00:00.000Z" } as const;
/** Stable manual routine origin used to prove that manual firings never claim a schedule slot. */
const _MANUAL = { ..._AUTOMATIC, trigger: RoutineFiringTrigger.Manual, scheduledSlot: null } as const;

describe("conversation genesis origin validation", function _Suite()
{
	it.each([_GROUP_CHILD, _AUTOMATIC, _MANUAL])("accepts one exact closed origin arm", function _Valid(origin)
	{
		expect(___ParseConversationGenesisOrigin(origin)).toEqual(origin);
	});

	it.each([
		["legacy group origin without a kind", { requestId: _GROUP_CHILD.requestId, parentConversationId: _GROUP_CHILD.parentConversationId, parentMessageId: _GROUP_CHILD.parentMessageId, parentMessagePosition: _GROUP_CHILD.parentMessagePosition }],
		["unknown field", { ..._AUTOMATIC, secret: true }],
		["zero revision", { ..._AUTOMATIC, routineRevision: 0 }],
		["unsafe revision", { ..._AUTOMATIC, routineRevision: Number.MAX_SAFE_INTEGER + 1 }],
		["blank identifier", { ..._AUTOMATIC, firingId: " " }],
		["manual slot", { ..._MANUAL, scheduledSlot: "2026-09-25T10:00:00.000Z" }],
		["automatic null slot", { ..._AUTOMATIC, scheduledSlot: null }],
		["invalid automatic slot", { ..._AUTOMATIC, scheduledSlot: "2026-09-25" }],
		["unknown trigger", { ..._AUTOMATIC, trigger: "delayed" }],
	])("rejects %s", function _Invalid(_name, origin)
	{
		expect(function _Parse() { ___ParseConversationGenesisOrigin(origin); }).toThrow();
	});
});
