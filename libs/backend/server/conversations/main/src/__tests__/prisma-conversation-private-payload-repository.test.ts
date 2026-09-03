import { describe, expect, it, vi } from "vitest";

import { PrismaConversationPrivatePayloadRepository } from "../db/prisma-conversation-private-payload-repository";
import type { ConversationPrivatePayloadStoreCommand } from "../conversation-private-payload-store.types";

describe("PrismaConversationPrivatePayloadRepository", function _PrismaConversationPrivatePayloadRepository()
{
	it("selects only persisted owner coordinates from a broader store command", async function _SelectsOwnerKey()
	{
		const findUnique = vi.fn().mockResolvedValue(null);
		const repository = new PrismaConversationPrivatePayloadRepository({ conversationPrivatePayload: { findUnique } } as never);
		const command: ConversationPrivatePayloadStoreCommand = { siloId: "silo-1", conversationId: "conversation-1", idempotencyKey: "command-1", text: "Private reply" };
		await repository.find(command);
		expect(findUnique).toHaveBeenCalledWith({
			where: { siloId_conversationId_idempotencyKey: { siloId: "silo-1", conversationId: "conversation-1", idempotencyKey: "command-1" } },
		});
	});
});
