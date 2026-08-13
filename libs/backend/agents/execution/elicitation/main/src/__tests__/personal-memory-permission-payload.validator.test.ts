import { describe, expect, it } from "vitest";

import { _ParsePersonalMemoryPermissionPayload, PersonalMemoryPermissionPayloadSchema } from "../personal-memory-permission-payload.validator.js";

/** Build one exact protected payload accepted at the persistence boundary. */
function _Payload(): Record<string, unknown>
{
	return {
		toolInvocationId: "invocation-1",
		toolInvocationRevision: 4,
		runId: "run-1",
		attempt: 2,
		executionSubjectId: "user-1",
		queryDigest: `sha256:${"a".repeat(64)}`,
		inputSnapshotDigest: `sha256:${"b".repeat(64)}`,
		personaRevisionId: "persona-1",
		expiresAt: "2026-08-12T12:15:00.000Z",
	};
}

describe("PersonalMemoryPermissionPayloadSchema", function _DescribePersonalMemoryPermissionPayloadSchema()
{
	it("rejects additional properties at the protected persistence boundary", function _RejectsAdditionalProperties()
	{
		const payload = { ..._Payload(), recalledContent: "must never be accepted" };

		expect(PersonalMemoryPermissionPayloadSchema.safeParse(payload).success).toBe(false);
		expect(_ParsePersonalMemoryPermissionPayload(payload)).toBeNull();
	});

	it("rejects malformed canonical digests", function _RejectsMalformedDigests()
	{
		const uppercase = { ..._Payload(), queryDigest: `sha256:${"A".repeat(64)}` };
		const short = { ..._Payload(), inputSnapshotDigest: `sha256:${"b".repeat(63)}` };

		expect(PersonalMemoryPermissionPayloadSchema.safeParse(uppercase).success).toBe(false);
		expect(PersonalMemoryPermissionPayloadSchema.safeParse(short).success).toBe(false);
	});
});
