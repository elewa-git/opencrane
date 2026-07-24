import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { __CreatePersonaDraft } from "../persona-draft-authority.js";
import { PrismaPersonaDraftRepository } from "../prisma-persona-draft-repository.js";

/** Shared valid owner command with three distinct persisted-answer references. */
const _COMMAND = {
	siloId: "silo-1",
	userId: "user-1",
	personaProfileId: "profile-1",
	interviewId: "interview-1",
	insights: [{ answerId: "answer-1", statement: "Challenge my assumptions." }, { answerId: "answer-2", statement: "Use concise paragraphs." }, { answerId: "answer-3", statement: "Ask before external actions." }],
	authoredAt: "2026-07-23T12:00:00.000Z",
} as const;

/** Build a narrow Prisma fake whose raw reads follow the draft-creation transaction order. */
function _Prisma(rawResults: readonly unknown[]): PrismaClient
{
	const client: Record<string, unknown> = {
		$queryRaw: vi.fn(),
		personaRevision: { create: vi.fn().mockResolvedValue({ id: "persona-2" }) },
		personaInsight: { createMany: vi.fn().mockResolvedValue({ count: 3 }) },
	};
	client.$queryRaw = vi.fn();
	for (const result of rawResults) (client.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce(result);
	client.$transaction = vi.fn(async function _transaction(callback: (transaction: unknown) => Promise<unknown>): Promise<unknown> { return callback(client); });
	return client as unknown as PrismaClient;
}

describe("persona draft authority", function _describePersonaDraftAuthority()
{
	it("rejects an insight statement beyond the durable four-thousand-character limit", async function _RejectsOversizedInsight()
	{
		const createAtomically = vi.fn();
		const repository = { createAtomically };
		const result = await __CreatePersonaDraft(repository, { ..._COMMAND, insights: [{ answerId: "answer-1", statement: "a".repeat(4_001) }, ..._COMMAND.insights.slice(1)] });
		expect(result).toEqual({ outcome: "denied", reason: "invalid_command" });
		expect(createAtomically).not.toHaveBeenCalled();
	});
	it("does not call persistence for duplicate answer evidence", async function _rejectsDuplicateAnswer()
	{
		const createAtomically = vi.fn();
		const result = await __CreatePersonaDraft({ createAtomically }, { ..._COMMAND, insights: [{ answerId: "answer-1", statement: "First" }, { answerId: "answer-1", statement: "Second" }, { answerId: "answer-3", statement: "Third" }] });
		expect(result).toEqual({ outcome: "denied", reason: "invalid_command" });
		expect(createAtomically).not.toHaveBeenCalled();
	});

	it("derives the selected template and question provenance rather than accepting caller-selected coordinates", async function _derivesDraftCoordinates()
	{
		const prisma = _Prisma([
			[{ activeRevisionId: "persona-1" }],
			[{ id: "interview-1" }],
			[{ templateId: "template-1", templateVersion: 2, templateDigest: `sha256:${"a".repeat(64)}`, content: "# Collaborator", selectionRuleId: "rule-1", selectionAnswerIds: ["answer-1"] }],
			[{ answerId: "answer-1", category: "RelationshipRole", questionSetId: "set-1", questionSetVersion: 1, questionId: "question-1" }, { answerId: "answer-2", category: "ToneLanguage", questionSetId: "set-1", questionSetVersion: 1, questionId: "question-2" }, { answerId: "answer-3", category: "ApprovalRisk", questionSetId: "set-1", questionSetVersion: 1, questionId: "question-3" }],
			[{ nextRevision: 2 }],
		]);
		const repository = new PrismaPersonaDraftRepository(prisma);

		await expect(repository.createAtomically(_COMMAND)).resolves.toEqual({ status: "created", personaRevisionId: "persona-2" });
		expect(prisma.personaRevision.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ revision: 2, soulTemplateId: "template-1", selectionRuleId: "rule-1", previousRevisionId: "persona-1" }) }));
		expect(prisma.personaInsight.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ answerId: "answer-1", questionId: "question-1", category: "RelationshipRole" })]) }));
	});

	it("fails closed when the owner profile cannot be locked in the supplied silo", async function _rejectsMissingOwner()
	{
		const prisma = _Prisma([[]]);
		const repository = new PrismaPersonaDraftRepository(prisma);

		await expect(repository.createAtomically(_COMMAND)).resolves.toEqual({ status: "not_found_or_wrong_owner" });
		expect(prisma.personaRevision.create).not.toHaveBeenCalled();
	});
});
