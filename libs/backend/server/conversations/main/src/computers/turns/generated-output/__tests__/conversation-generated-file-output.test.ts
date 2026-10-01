import { describe, expect, it } from "vitest";

import { ConversationEntryKinds, ConversationMessageContentBlockKinds, type ArtifactMessageContentBlock } from "@opencrane/contracts";

import { _PrepareConversationOutputIntent } from "../../__tests__/conversation-output-intent.fixture";
import { _OutputRecoveryHarness } from "../../__tests__/conversation-output-recovery.fixture";

describe("generated file output reservation", function _OutputReservation()
{
	it("refuses an Artifact on the first model answer before any history append", async function _FirstAnswerHasNoFile()
	{
		const f = await _OutputRecoveryHarness();
		const turn = (await f.store.load(f.output.bootstrapId))!;
		const intent = await _PrepareConversationOutputIntent(turn, f.output.sourceCommandId);
		const entry = intent.event.data.entry;
		if (entry.kind !== ConversationEntryKinds.Message)
			throw new Error("Fixture did not prepare an answer");
		const artifact: ArtifactMessageContentBlock = { id: "asset-1", kind: ConversationMessageContentBlockKinds.Artifact, artifactId: "artifact-1", artifactRevisionId: "revision-1", name: "counties.csv", mediaType: "text/csv;charset=utf-8" };
		const substituted = { ...intent, event: { ...intent.event, data: { ...intent.event.data, entry: { ...entry, blocks: [...entry.blocks, artifact] } } } };
		await expect(f.store.markOutput(turn.bootstrapId, substituted)).rejects.toThrow("invalid generated file");
		expect((await f.store.load(turn.bootstrapId))!.protocol.output).toBeNull();
		expect(f.history.streams.get(f.stream)).toHaveLength(2);
	});
});
