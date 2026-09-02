import { describe, expect, it, vi } from "vitest";

import { ConversationComputerParticipantInputAdmission } from "../conversation-computer-participant-input-admission";
import { ConversationComputerParticipantInputOutcomes, type ConversationComputerParticipantInputAuthor } from "../conversation-computer-participant-input-authority.types";
import type { ConversationComputerParticipantInputAuthorizer } from "../conversation-computer-participant-input-admission.types";
import type { ConversationCaller } from "../../types/conversation-caller.types";

/** Fixes one target caller whose authenticated coordinates never come from a browser body. */
const _CALLER: ConversationCaller = { siloId: "testv5", principalId: "principal-1", subjectId: "participant-1", issuer: "https://issuer.example" };
/** Fixes one immutable UUID retry key for target input handoff assertions. */
const _INPUT_ID = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";
/** Captures the current human facts only the authorizer may resolve. */
const _AUTHOR: ConversationComputerParticipantInputAuthor = { principalId: _CALLER.principalId, participantId: _CALLER.subjectId, name: "Jente", avatarArtifactRevisionId: null };

/** Creates narrow target admission dependencies and retains every boundary call for assertions. */
function _Subject(authorized: { readonly computerId: string; readonly author: ConversationComputerParticipantInputAuthor } | null = { computerId: "computer-1", author: _AUTHOR })
{
	const authorizer = { authorize: vi.fn().mockResolvedValue(authorized) } satisfies ConversationComputerParticipantInputAuthorizer;
	const inputs = { admit: vi.fn().mockResolvedValue({ outcome: ConversationComputerParticipantInputOutcomes.Accepted, inputEntryId: _INPUT_ID }) };
	return { authorizer, inputs, admission: new ConversationComputerParticipantInputAdmission(authorizer, inputs) };
}

describe("ConversationComputerParticipantInputAdmission", function _ConversationComputerParticipantInputAdmissionSuite()
{
	it("passes only current server-authorized coordinates to durable participant input", async function _AdmitsAuthorizedInput()
	{
		const subject = _Subject();

		await expect(subject.admission.admit(_CALLER, "conversation-1", { inputId: _INPUT_ID, text: "Please prepare the release notes." })).resolves.toEqual({ outcome: ConversationComputerParticipantInputOutcomes.Accepted, inputEntryId: _INPUT_ID });

		expect(subject.authorizer.authorize).toHaveBeenCalledWith(_CALLER, "conversation-1", { inputId: _INPUT_ID, text: "Please prepare the release notes." });
		expect(subject.inputs.admit).toHaveBeenCalledWith({ siloId: "testv5", conversationId: "conversation-1", computerId: "computer-1", inputId: _INPUT_ID, text: "Please prepare the release notes.", author: _AUTHOR });
	});

	it("does not let an unavailable participant reach immutable history", async function _DeniesUnavailableInput()
	{
		const subject = _Subject(null);

		await expect(subject.admission.admit(_CALLER, "conversation-1", { inputId: _INPUT_ID, text: "Please prepare the release notes." })).resolves.toBeNull();

		expect(subject.inputs.admit).not.toHaveBeenCalled();
	});
});
