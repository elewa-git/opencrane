import { describe, expect, it } from "vitest";

import { GroupChildStates } from "../group-child.types";
import { ___GroupChildCreateCommandSchema, ___ParseGroupChildOrigin, ___ParseGroupChildView } from "../group-child.validator";

/** Supplies the server's public creation progress without authority or runtime metadata. */
const _CHILD = { conversationId: "child", parentConversationId: "group", parentMessageId: "57de859d-1fb6-4782-aa0b-2b3d4dfd2292", parentMessagePosition: "2", state: GroupChildStates.Pending, agentName: "Research assistant" };
/** Selects no additional recipients until the caller explicitly adds membership references. */
const _CREATE = { parentMessageId: _CHILD.parentMessageId, parentMessagePosition: "2", agentServiceId: "assistant", participantRefs: [] as string[], idempotencyKey: "772340d2-5718-40c4-bca9-24d47d63ba9b" };

describe("explicit group child creation", function _Creation()
{
	it("requires an explicit selection and allows requester-only creation", function _RequesterOnly()
	{
		expect(___GroupChildCreateCommandSchema.parse(_CREATE)).toEqual(_CREATE);
		const { participantRefs: _selection, ...missing } = _CREATE;
		expect(___GroupChildCreateCommandSchema.safeParse(missing).success).toBe(false);
	});
	it("normalises UUIDs and sorts opaque case-sensitive references without changing the input", function _CanonicalRetry()
	{
		const command = { ..._CREATE, parentMessageId: _CREATE.parentMessageId.toUpperCase(), idempotencyKey: _CREATE.idempotencyKey.toUpperCase(), participantRefs: ["z-member", "a-member", "A-member"] };
		expect(___GroupChildCreateCommandSchema.parse(command)).toEqual({ ..._CREATE, participantRefs: ["A-member", "a-member", "z-member"] });
		expect(command.participantRefs).toEqual(["z-member", "a-member", "A-member"]);
	});
	it.each([["same", "same"], [""], [" member"], ["member "], ["x".repeat(257)], Array.from({ length: 100 }, (_, index) => `member-${index}`)].map(participantRefs => ({ participantRefs })))("rejects invalid participant references %j", function _InvalidRefs({ participantRefs })
	{
		expect(___GroupChildCreateCommandSchema.safeParse({ ..._CREATE, participantRefs }).success).toBe(false);
	});
	it.each(["0", "01", "-1", "18446744073709551615", "18446744073709551616", "not-a-position"])("rejects invalid creation revision %s", function _InvalidPosition(parentMessagePosition)
	{
		expect(___GroupChildCreateCommandSchema.safeParse({ ..._CREATE, parentMessagePosition }).success).toBe(false);
	});
	it.each(["00000000-0000-0000-0000-000000000000", "772340d2-5718-90c4-bca9-24d47d63ba9b", "772340d2-5718-40c4-0ca9-24d47d63ba9b"])("preserves the command UUID boundary for %s", function _InvalidUuid(uuid)
	{
		expect(___GroupChildCreateCommandSchema.safeParse({ ..._CREATE, parentMessageId: uuid }).success).toBe(false);
		expect(___GroupChildCreateCommandSchema.safeParse({ ..._CREATE, idempotencyKey: uuid }).success).toBe(false);
	});
	it("rejects undeclared authority and subject-id audience fields", function _UntrustedAuthority()
	{
		for (const extra of [{ principalId: "admin" }, { participantIds: ["subject"] }, { participantSubjectIds: ["subject"] }, { siloId: "foreign" }])
			expect(___GroupChildCreateCommandSchema.safeParse({ ..._CREATE, ...extra }).success).toBe(false);
	});
});

describe("group child public projections", function _Describe()
{
	it.each(Object.values(GroupChildStates))("accepts the %s creation state without implying work completed", function _State(state)
	{
		expect(___ParseGroupChildView({ ..._CHILD, state }).state).toBe(state);
	});
	it.each(["0", "-1", "01", "18446744073709551616", "1.2", "not-a-position"])("rejects source revision %s", function _Position(parentMessagePosition)
	{
		expect(function _Parse() { ___ParseGroupChildView({ ..._CHILD, parentMessagePosition }); }).toThrow();
	});
	it("rejects self-parenting, unknown state, and extra private fields", function _Rejects()
	{
		for (const extra of [{ conversationId: "group" }, { state: "completed" }, { principalId: "private" }])
			expect(function _Parse() { ___ParseGroupChildView({ ..._CHILD, ...extra }); }).toThrow();
	});
	it("preserves the full uint64 revision in a strict origin", function _Origin()
	{
		const origin = { requestId: _CHILD.parentMessageId, parentConversationId: "group", parentMessageId: _CHILD.parentMessageId, parentMessagePosition: "18446744073709551615" };
		expect(___ParseGroupChildOrigin(origin)).toEqual(origin);
		expect(function _Parse() { ___ParseGroupChildOrigin({ ...origin, secret: true }); }).toThrow();
	});
});
