import type { Prisma } from "@prisma/client";

import type { RuntimeEventCandidate } from "@opencrane/contracts";

import type { RuntimeTranscriptReporter, RuntimeTranscriptReportResult } from "./runtime-transcript-reporter.types.js";

/** Persist bounded non-terminal runtime evidence as canonical replay events. */
export class PrismaRuntimeTranscriptReporter implements RuntimeTranscriptReporter
{
	/** Append only canonical transcript evidence while the caller holds the attempt fence. */
	async reportInTransaction(transaction: Prisma.TransactionClient, command: RuntimeEventCandidate): Promise<RuntimeTranscriptReportResult>
	{
		const run = await transaction.agentRun.findUnique({ where: { id: command.runId }, select: { attempt: true, threadId: true } });
		if (run === null || run.attempt !== command.attempt) return { outcome: "denied", reason: "run_not_current" };
		const events = _Events(command);
		if (events === null) return { outcome: "denied", reason: "unsupported_runtime_event" };
		if (run.threadId === null || events.length === 0) return { outcome: "reported" };
		const maximum = await transaction.conversationRunEvent.aggregate({ where: { runId: command.runId }, _max: { sequence: true } });
		const messageId = `runtime:${command.runId}:attempt:${command.attempt}`;
		const existingMessage = await transaction.conversationRunEvent.findFirst({ where: { runId: command.runId, type: "message.started", payload: { path: ["messageId"], equals: messageId } }, select: { sequence: true } });
		let sequence = maximum._max.sequence ?? 0;
		for (const event of events)
		{
			if (event.type === "message.started" && existingMessage !== null) continue;
			sequence += 1;
			await transaction.conversationRunEvent.create({ data: { runId: command.runId, sequence, type: event.type, payload: event.payload, occurredAt: new Date() } });
		}
		return { outcome: "reported" };
	}
}

/** Translate bounded runtime vocabulary into the stable public transcript vocabulary. */
function _Events(candidate: RuntimeEventCandidate): readonly { readonly type: string; readonly payload: Prisma.InputJsonObject }[] | null
{
	if (candidate.eventType === "run.started") return [{ type: "run.started", payload: _StartedPayload(candidate.payload) }];
	if (candidate.eventType === "run.resumed") return [];
	if (candidate.eventType === "run.usage") return [{ type: "run.usage", payload: _UsagePayload(candidate.payload) }];
	if (candidate.eventType !== "run.output_text") return null;
	const text = _Text(candidate.payload, "text");
	if (text === null || text.length === 0) return [];
	const messageId = `runtime:${candidate.runId}:attempt:${candidate.attempt}`;
	return [{ type: "message.started", payload: { messageId } }, ..._MessageDeltas(messageId, text)];
}

/** Preserve only the compiler version emitted by a runtime start frame. */
function _StartedPayload(value: unknown): Prisma.InputJsonObject
{
	const promptCompilerVersion = _String(value, "promptCompilerVersion");
	return promptCompilerVersion === null ? {} : { promptCompilerVersion };
}

/** Preserve only non-negative integer model-usage counters. */
function _UsagePayload(value: unknown): Prisma.InputJsonObject
{
	return { inputTokens: _NonNegativeInteger(value, "inputTokens"), outputTokens: _NonNegativeInteger(value, "outputTokens") };
}

/** Read one bounded string field from an untrusted JSON object. */
function _String(value: unknown, key: string): string | null
{
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const field = (value as Record<string, unknown>)[key];
	return typeof field === "string" && field.length <= 512 ? field : null;
}

/** Read one output field and preserve every bounded byte by deterministic replay-sized chunks. */
function _Text(value: unknown, key: string): string | null
{
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const field = (value as Record<string, unknown>)[key];
	return typeof field === "string" && field.length <= 65_536 ? field : null;
}

/** Split output on fixed UTF-16 boundaries so retrying the same candidate emits the same replay. */
function _MessageDeltas(messageId: string, text: string): readonly { readonly type: "message.delta"; readonly payload: Prisma.InputJsonObject }[]
{
	const maximumDeltaLength = 512;
	const deltas: { type: "message.delta"; payload: Prisma.InputJsonObject }[] = [];
	for (let offset = 0; offset < text.length; offset += maximumDeltaLength) deltas.push({ type: "message.delta", payload: { messageId, delta: text.slice(offset, offset + maximumDeltaLength) } });
	return deltas;
}

/** Read one bounded non-negative JSON integer. */
function _NonNegativeInteger(value: unknown, key: string): number
{
	if (typeof value !== "object" || value === null || Array.isArray(value)) return 0;
	const field = (value as Record<string, unknown>)[key];
	return typeof field === "number" && Number.isSafeInteger(field) && field >= 0 ? field : 0;
}
