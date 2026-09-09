import { describe, expect, it } from "vitest";

import { ConversationComputerStates, type ConversationComputer } from "../conversation-computer.types";
import { ___ConversationComputerSchema } from "../conversation-computer.validator";

/** Supplies the existing public computer shape without sandbox credentials. */
function _Computer(): ConversationComputer
{
	return { schemaVersion: 1, id: "computer-1", siloId: "silo-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1", state: ConversationComputerStates.Cold, leaseGeneration: 0, workspaceCheckpoint: null, createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z" };
}

describe("ConversationComputer schema", function _DescribeComputer()
{
	it("accepts the existing public shape and checkpoint metadata", function _ValidComputer()
	{
		const computer = { ..._Computer(), workspaceCheckpoint: { artifactRevisionId: "artifact-1", digest: "sha256:digest", format: "workspace-v1", checkpointedAt: "2026-09-05T00:00:00.000Z" } };
		expect(___ConversationComputerSchema.parse(computer)).toEqual(computer);
	});

	it.each([
		{ siloId: "" }, { conversationId: " " }, { agentIdentityId: null }, { profileRevisionId: 3 },
		{ state: "invented" }, { leaseGeneration: -1 }, { leaseGeneration: 0.5 },
		{ leaseGeneration: Number.MAX_SAFE_INTEGER + 1 }, { workspaceCheckpoint: {} },
		{ sandboxToken: "unexpected-private-field" }
	])("rejects malformed coordinates, lifecycle and private extensions", function _MalformedComputer(change)
	{
		expect(___ConversationComputerSchema.safeParse({ ..._Computer(), ...change }).success).toBe(false);
	});
});
