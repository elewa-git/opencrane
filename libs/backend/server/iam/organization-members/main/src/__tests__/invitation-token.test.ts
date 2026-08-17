import { describe, expect, it } from "vitest";

import { HmacOrganizationInvitationTokenAuthority } from "../invitation-token";

describe("HmacOrganizationInvitationTokenAuthority", function _Suite()
{
	it("round-trips exact coordinates and rejects tampering", function _RoundTrip()
	{
		const authority = new HmacOrganizationInvitationTokenAuthority(Buffer.alloc(32, 7));
		const token = authority.issue({ invitationId: "invite-1", generation: 3, nonce: "abcdefghijklmnop" });
		expect(authority.verify(token)).toEqual({ invitationId: "invite-1", generation: 3, nonce: "abcdefghijklmnop" });
		expect(authority.verify(`${token}x`)).toBeNull();
	});

	it("does not admit a token issued under another deployment key", function _WrongKey()
	{
		const first = new HmacOrganizationInvitationTokenAuthority(Buffer.alloc(32, 1));
		const second = new HmacOrganizationInvitationTokenAuthority(Buffer.alloc(32, 2));
		expect(second.verify(first.issue({ invitationId: "invite-1", generation: 1, nonce: "abcdefghijklmnop" }))).toBeNull();
	});
});
