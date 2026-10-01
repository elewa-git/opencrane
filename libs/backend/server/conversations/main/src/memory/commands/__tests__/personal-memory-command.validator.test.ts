import { describe, expect, it } from "vitest";
import { PersonalMemoryOperationKinds } from "@opencrane/backend/agents/personal/memory";

import { _PersonalMemoryCommandSchema } from "../personal-memory-command.validator";

const _SOURCE = { conversationId: "conversation-1", messageId: "message-1", messagePosition: "7" };
const _REMEMBER = { commandId: "928b379d-d679-42db-bd46-c938bb15f3d1", kind: PersonalMemoryOperationKinds.Remember, source: _SOURCE };
const _FORGET = { commandId: _REMEMBER.commandId, kind: PersonalMemoryOperationKinds.Forget, targetFactId: "fact-1", expectedFactRevision: 3 };

describe("personal memory command boundary", function _Suite()
{
	it.each(["text", "actorPrincipalId", "datasetId", "providerDatasetId", "taskId"])("rejects caller-supplied %s", function _UntrustedField(field)
	{
		expect(_PersonalMemoryCommandSchema.safeParse({ ..._REMEMBER, [field]: "not request authority" }).success).toBe(false);
	});

	it.each(["", "0", "-1", "01", "1.0", "abc", "9223372036854775808", "1".repeat(200)])("refuses malformed position %j without throwing", function _InvalidPosition(messagePosition)
	{
		expect(_PersonalMemoryCommandSchema.safeParse({ ..._REMEMBER, source: { ..._SOURCE, messagePosition } }).success).toBe(false);
	});

	it("requires correction to bind both its replacement source and target revision", function _Correction()
	{
		const correction = { ..._REMEMBER, kind: PersonalMemoryOperationKinds.Correct, targetFactId: _FORGET.targetFactId, expectedFactRevision: _FORGET.expectedFactRevision };
		expect(_PersonalMemoryCommandSchema.safeParse(correction).success).toBe(true);
		expect(_PersonalMemoryCommandSchema.safeParse({ ...correction, source: undefined }).success).toBe(false);
		expect(_PersonalMemoryCommandSchema.safeParse({ ...correction, expectedFactRevision: 0 }).success).toBe(false);
	});

	it("accepts Forget only without a replacement source", function _Forget()
	{
		expect(_PersonalMemoryCommandSchema.safeParse(_FORGET).success).toBe(true);
		expect(_PersonalMemoryCommandSchema.safeParse({ ..._FORGET, source: _SOURCE }).success).toBe(false);
	});

	it("refuses client-selected ciphertext coordinates", function _CiphertextSelection()
	{
		expect(_PersonalMemoryCommandSchema.safeParse({ ..._REMEMBER, source: { ..._SOURCE, payloadRef: "private-payload" } }).success).toBe(false);
	});
});
