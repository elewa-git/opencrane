import { describe, expect, it } from "vitest";

import { _ConversationComputerEventId } from "../conversation-computer-event-id";

/** Covers persisted domains with independently calculated outputs from the original encoding. */
const _VECTORS = [
	["settled", "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", "5e1e0a64-4b7d-4c13-8365-f5704cbe53ed"],
	["model-reservation", "invocation-fence-1", "c3de1d3f-23fd-41cc-8097-f37f2be82a39"],
	["tool-result-notification-entry", "tool-call-1", "bd704fcb-afa8-4738-823d-3877916e680e"],
] as const;

describe("conversation computer event ids", function _Suite()
{
	it.each(_VECTORS)("preserves the persisted UUID encoding for %s", function _Vector(domain, value, expected)
	{
		expect(_ConversationComputerEventId(domain, value)).toBe(expected);
	});
});
