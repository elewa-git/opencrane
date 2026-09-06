import { describe, expect, it, vi } from "vitest";
import { ProductAuthorizationActions } from "@opencrane/models/authorization";

import { _ConversationComputerReviewAuthority } from "../conversation-computer-review-authority";

const _CALLER = { principalId: "principal-1", subjectId: "subject-1", siloId: "silo-1" };
const _COORDINATES = { computerId: "computer-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1" };

/** Proves the review route carries a derived credential and never the public lease id. */
describe("_ConversationComputerReviewAuthority", function _Suite()
{
	it("derives the review credential from the admitted active lease", async function _Derives()
	{
		const metadata = { reviewCoordinates: vi.fn().mockResolvedValue(_COORDINATES) };
		const history = { loadActiveLease: vi.fn().mockResolvedValue({ lease: { id: "lease-1", generation: 2, sandboxId: "sandbox-1", serviceFQDN: "sandbox-1.ns.svc.cluster.local" } }) };
		const derive = vi.fn().mockReturnValue("keyed-secret");
		const authority = new _ConversationComputerReviewAuthority(metadata, history as never, { derive });
		const route = await authority.resolve(_CALLER, "conversation-1", ProductAuthorizationActions.Use);
		expect(route).toEqual({ reviewCredential: "keyed-secret", sandboxId: "sandbox-1", serviceFQDN: "sandbox-1.ns.svc.cluster.local" });
		expect(derive).toHaveBeenCalledWith({ siloId: "silo-1", computerId: "computer-1", generation: 2, leaseId: "lease-1" });
		expect(metadata.reviewCoordinates).toHaveBeenCalledWith(_CALLER, "conversation-1", ProductAuthorizationActions.Use);
	});

	it("derives nothing when admission fails or the lease has no route", async function _Withholds()
	{
		const derive = vi.fn();
		const denied = new _ConversationComputerReviewAuthority({ reviewCoordinates: vi.fn().mockResolvedValue(null) }, { loadActiveLease: vi.fn() } as never, { derive });
		expect(await denied.resolve(_CALLER, "conversation-1", ProductAuthorizationActions.Read)).toBeNull();
		const unrouted = new _ConversationComputerReviewAuthority({ reviewCoordinates: vi.fn().mockResolvedValue(_COORDINATES) }, { loadActiveLease: vi.fn().mockResolvedValue({ lease: { id: "lease-1", generation: 2, sandboxId: "sandbox-1", serviceFQDN: null } }) } as never, { derive });
		expect(await unrouted.resolve(_CALLER, "conversation-1", ProductAuthorizationActions.Read)).toBeNull();
		expect(derive).not.toHaveBeenCalled();
	});
});
