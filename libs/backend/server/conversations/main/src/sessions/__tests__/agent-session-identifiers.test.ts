import { describe, expect, it } from "vitest";
import { _AgentSessionCoordinates } from "../agent-session-identifiers";

/** Identifies the retry whose scope is exercised below. */
const _KEY = "57de859d-1fb6-4782-aa0b-2b3d4dfd2292";
/** Supplies verified request identity independently of the client key. */
const _CALLER = { siloId: "silo-1", subjectId: "subject-1", principalId: "principal-1" };

describe("personal session creation coordinates", function _Suite()
{
	it("scopes the same key to its silo and caller", function _ScopesCommand()
	{
		const original = _AgentSessionCoordinates(_CALLER, "service-1", _KEY);
		expect(_AgentSessionCoordinates({ ..._CALLER, siloId: "silo-2" }, "service-1", _KEY).conversationId).not.toBe(original.conversationId);
		expect(_AgentSessionCoordinates({ ..._CALLER, principalId: "principal-2" }, "service-1", _KEY).conversationId).not.toBe(original.conversationId);
		expect(_AgentSessionCoordinates(_CALLER, "service-1", _KEY.toUpperCase())).toEqual(original);
	});

	it("addresses existing history when a retry changes its assistant so genesis can reject the conflict", function _ChangedTarget()
	{
		const original = _AgentSessionCoordinates(_CALLER, "service-1", _KEY);
		const changed = _AgentSessionCoordinates(_CALLER, "service-2", _KEY);
		expect(changed.conversationId).toBe(original.conversationId);
		expect(changed.computerId).toBe(original.computerId);
		expect(changed.agentIdentityId).not.toBe(original.agentIdentityId);
	});
});
