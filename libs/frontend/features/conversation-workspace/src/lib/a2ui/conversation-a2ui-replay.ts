import { CONVERSATION_A2UI_PAYLOAD_BYTES, ConversationA2UIOperations, ConversationAuthorKinds, ConversationEntryKinds, type A2UIEntry, type ConversationEntry } from "@opencrane/contracts";

import { ConversationA2uiDisplayStates, type ConversationA2uiDisplayPresentation } from "./conversation-a2ui-display.types";
import { _ConversationA2uiGraphComplete } from "./conversation-a2ui-graph";
import { _ParseConversationA2uiMessages } from "./conversation-a2ui-message.validator";
import type { ConversationA2uiFrame, ConversationA2uiReplay } from "./conversation-a2ui-replay.types";
import { _ConversationA2uiSnapshot } from "./conversation-a2ui-snapshot";

/**
 * Replays only currently authorised history; it performs no fetch, admission or action dispatch.
 * The latest entry for each conversation/author/display owns the transcript row. A bad update
 * discards that display until Replace, while Remove hides it. Every call starts empty so selection
 * clearing and access loss cannot retain SDK state from a previous history projection.
 * @returns Latest entry ids mapped to read-only displays; removed displays have no row.
 */
export function _ConversationA2uiDisplays(entries: readonly ConversationEntry[], payloads: Readonly<Record<string, string>>): ReadonlyMap<string, ConversationA2uiDisplayPresentation>
{
	const displays = new Map<string, ConversationA2uiReplay>();
	let decodedBytes = 0;
	let overflow: A2UIEntry | null = null;
	for (const entry of entries)
	{
		if (entry.kind !== ConversationEntryKinds.A2UI)
			continue;
		const key = _DisplayKey(entry);
		const previous = displays.get(key);
		if (entry.operation === ConversationA2UIOperations.Remove)
		{
			displays.delete(key);
			continue;
		}
		if (!previous && displays.size >= 32)
		{
			// One sticky notice reports omitted history without retaining every skipped identity.
			overflow ??= entry;
			continue;
		}
		try
		{
			if (decodedBytes > 4_194_304)
				throw new Error("Structured display replay exceeds its limit");
			if (entry.a2uiSchemaVersion !== "0.8" || !Object.hasOwn(payloads, entry.payloadRef))
				throw new Error("Structured display payload is unavailable");
			const payload = payloads[entry.payloadRef]!;
			if (payload.length > CONVERSATION_A2UI_PAYLOAD_BYTES)
				throw new Error("Structured display exceeds its payload limit");
			const payloadBytes = new TextEncoder().encode(payload).byteLength;
			decodedBytes += payloadBytes;
			if (decodedBytes > 4_194_304)
				throw new Error("Structured display replay exceeds its limit");
			const frame = entry.operation === ConversationA2UIOperations.Replace ? _EmptyFrame() : previous?.frame;
			if (!frame)
				throw new Error("Structured display needs a new baseline");
			const messages = _ParseConversationA2uiMessages(payload, entry.surfaceId);
			frame.bytes += payloadBytes;
			frame.messages += messages.length;
			if (frame.bytes > 524_288 || frame.messages > 512)
				throw new Error("Structured display needs a new baseline");
			let removed = false;
			for (const message of messages)
			{
				if (removed)
					throw new Error("Structured display must be replaced after deletion");
				if (message.surfaceUpdate)
					for (const component of message.surfaceUpdate.components)
						frame.components.set(component.id, component);
				if (message.beginRendering)
					frame.root = message.beginRendering.root;
				if (message.dataModelUpdate)
					frame.data.push(message.dataModelUpdate);
				removed = message.deleteSurface !== undefined;
			}
			if (!removed)
				_ConversationA2uiGraphComplete(frame);
			if (removed)
				displays.delete(key);
			else
				displays.set(key, { entry, frame });
		}
		catch
		{
			// The unavailable row reports the rejected update without logging its private payload.
			displays.set(key, { entry, frame: null });
		}
	}
	const result = new Map<string, ConversationA2uiDisplayPresentation>();
	for (const { entry, frame } of displays.values())
	{
		try
		{
			if (!frame)
				throw new Error("Structured display is unavailable");
			result.set(entry.id, _ConversationA2uiSnapshot(frame, entry.surfaceId, entry.author.name));
		}
		catch
		{
			result.set(entry.id, { state: ConversationA2uiDisplayStates.Unavailable, authorName: entry.author.name, surfaceId: entry.surfaceId, surface: null, detail: "This structured result is unavailable. Other conversation messages remain available." });
		}
	}
	if (overflow)
		result.set(overflow.id, { state: ConversationA2uiDisplayStates.Unavailable, authorName: "OpenCrane", surfaceId: "replay-overflow", surface: null, detail: "Display history exceeds this page's limit. Some results may be omitted." });
	return result;
}

/** Starts a Replace without reusing definitions or data from the preceding display. */
function _EmptyFrame(): ConversationA2uiFrame
{
	return { components: new Map(), data: [], root: null, bytes: 0, messages: 0 };
}

/** Uses stamped identity coordinates, never the author's mutable display name. */
function _DisplayKey(entry: A2UIEntry): string
{
	const author = entry.author;
	let identity: readonly string[];
	switch (author.kind)
	{
		case ConversationAuthorKinds.Human: identity = [author.issuer, author.principalId, author.participantId]; break;
		case ConversationAuthorKinds.Agent: identity = [author.agentIdentityId, author.agentServiceId]; break;
		case ConversationAuthorKinds.Service: identity = [author.serviceId]; break;
		case ConversationAuthorKinds.System: identity = [author.systemId]; break;
		default: throw new Error("Unsupported structured display author");
	}
	return JSON.stringify([entry.conversationId, author.kind, identity, entry.surfaceId]);
}
