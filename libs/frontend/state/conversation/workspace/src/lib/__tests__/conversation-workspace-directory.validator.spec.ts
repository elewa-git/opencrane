import { describe, expect, it } from "vitest";

import { ConversationPersonalAgentStatuses } from "../conversation-workspace.types";
import { _ParseConversationWorkspaceDirectory } from "../conversation-workspace.validator";

/** Builds the server's named creation-directory response. */
function _Directory()
{
	return { participants: [{ participantRef: "self-secret", isSelf: true, displayName: "Jente" }, { participantRef: "other-secret", isSelf: false, displayName: " Amina " }], personalAgentStatus: ConversationPersonalAgentStatuses.Unavailable, personalAgent: null };
}

describe("conversation member display names", function _Suite()
{
	it("uses explicit display names and renders the signed-in member as You", function _Names()
	{
		const directory = _ParseConversationWorkspaceDirectory(_Directory());
		expect(directory.participants).toEqual([{ participantRef: "self-secret", isSelf: true, label: "You" }, { participantRef: "other-secret", isSelf: false, label: "Amina" }]);
	});

	it("rejects missing or blank names instead of deriving labels from member references", function _MissingNames()
	{
		const directory = _Directory();
		expect(() => _ParseConversationWorkspaceDirectory({ ...directory, participants: [{ participantRef: "opaque-secret", isSelf: false }] })).toThrow();
		expect(() => _ParseConversationWorkspaceDirectory({ ...directory, participants: [{ participantRef: "opaque-secret", isSelf: false, displayName: "   " }] })).toThrow();
	});

	it("rejects extra identity fields even when an explicit display name is present", function _PrivateFields()
	{
		const directory = _Directory();
		expect(() => _ParseConversationWorkspaceDirectory({ ...directory, participants: [{ ...directory.participants[1], email: "private@example.test" }] })).toThrow();
		expect(() => _ParseConversationWorkspaceDirectory({ ...directory, participants: [{ ...directory.participants[1], subject: "login-secret" }] })).toThrow();
	});
});
