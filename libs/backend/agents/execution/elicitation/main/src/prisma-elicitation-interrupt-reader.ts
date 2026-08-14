import type { PrismaClient } from "@prisma/client";

import { ElicitationBodyKinds, RunEventTypes, type AgUiProjectionSourceEvent, type ConversationElicitation } from "@opencrane/contracts";

import { PrismaElicitationUnitOfWork } from "./prisma-elicitation-unit-of-work";
import type { ElicitationInterruptReader } from "./elicitation-interrupt.types";

/** Compose generic request overlays over the elicitation authority. */
export function _CreateElicitationInterruptReader(prisma: PrismaClient): ElicitationInterruptReader
{
	const elicitations = new PrismaElicitationUnitOfWork(prisma);
	return {
		async readOpen(command): Promise<readonly AgUiProjectionSourceEvent[]>
		{
			const open = await elicitations.listOpenOwned(command.siloId, command.conversationId, command.subjectId, new Date());
			return open.map(function _Project(elicitation): AgUiProjectionSourceEvent
			{
				return { conversationId: elicitation.conversationId, runId: elicitation.runId, position: "0", eventType: RunEventTypes.ElicitationRequested, occurredAt: elicitation.requestedAt, payload: { interrupt: { id: elicitation.requestId, reason: elicitation.purpose, message: elicitation.body.prompt, responseSchema: _ResponseSchema(elicitation), expiresAt: elicitation.expiresAt, metadata: { elicitation } } } };
			});
		},
	};
}

/** Derive only a display-validation schema from the already browser-safe request body. */
function _ResponseSchema(elicitation: ConversationElicitation): Record<string, unknown>
{
	const body = elicitation.body;
	if (body.kind === ElicitationBodyKinds.Approval) return { type: "object", additionalProperties: false, required: ["kind", "approved"], properties: { kind: { const: body.kind }, approved: { type: "boolean" } } };
	if (body.kind === ElicitationBodyKinds.SingleChoice) return { type: "object", additionalProperties: false, required: ["kind", "selection"], properties: { kind: { const: body.kind }, selection: { type: "string", enum: body.choices.map(function _Value(choice) { return choice.value; }) } } };
	if (body.kind === ElicitationBodyKinds.MultipleChoice) return { type: "object", additionalProperties: false, required: ["kind", "selections"], properties: { kind: { const: body.kind }, selections: { type: "array", uniqueItems: true, minItems: body.minimumSelections, maxItems: body.maximumSelections, items: { type: "string", enum: body.choices.map(function _Value(choice) { return choice.value; }) } } } };
	return { type: "object", additionalProperties: false, required: ["kind", "text"], properties: { kind: { const: body.kind }, text: { type: "string", maxLength: body.maximumLength } } };
}
