import { describe, expect, it, vi } from "vitest";

import { OrganizationMemberRoles } from "../directory.types";
import { FleetOrganizationMembershipAuthority } from "../fleet-organization-membership-authority";
import type { FleetOrganizationMembershipTransport } from "../fleet-organization-membership-transport.types";
import { OrganizationMembershipErrorKinds } from "../organization-members.errors";

/** Verified caller fixture. */
const _CALLER = { siloId: "acme", subjectId: "admin-1", verifiedEmail: "admin@acme.test", displayName: "Admin" };

/** Builds one authority over a focused transport seam. */
function _Authority(status: number, body: unknown, siloId = "acme")
{
	const transport = { request: vi.fn().mockResolvedValue({ status, body }) } satisfies FleetOrganizationMembershipTransport;
	return { authority: new FleetOrganizationMembershipAuthority(transport, siloId), transport };
}

describe("FleetOrganizationMembershipAuthority", function _Suite()
{
	it("maps Fleet seat authority to the stable payment_required result", async function _Payment()
	{
		const { authority } = _Authority(402, { error: { code: "SEAT_OR_PAYMENT_REQUIRED" } });
		await expect(authority.create({ caller: _CALLER, emails: ["new@acme.test"], role: OrganizationMemberRoles.Member, idempotencyKey: "0123456789abcdef" })).rejects.toMatchObject({ kind: OrganizationMembershipErrorKinds.PaymentRequired });
	});

	it("preserves acceptance terminal errors only on acceptance", async function _TerminalError()
	{
		const { authority } = _Authority(409, { error: { code: "ALREADY_USED" } });
		await expect(authority.accept({ caller: _CALLER, token: "x".repeat(64) })).rejects.toMatchObject({ kind: OrganizationMembershipErrorKinds.AlreadyUsed });
		await expect(authority.create({ caller: _CALLER, emails: ["new@acme.test"], role: OrganizationMemberRoles.Member, idempotencyKey: "0123456789abcdef" })).rejects.toMatchObject({ kind: OrganizationMembershipErrorKinds.Unavailable });
	});

	it("refuses a foreign silo before calling the transport", async function _SiloFence()
	{
		const { authority, transport } = _Authority(200, {}, "other");
		await expect(authority.directory(_CALLER)).rejects.toMatchObject({ kind: OrganizationMembershipErrorKinds.Forbidden });
		expect(transport.request).not.toHaveBeenCalled();
	});

	it("maps transport failures to fail-closed unavailability", async function _TransportFailure()
	{
		const transport = { request: vi.fn().mockRejectedValue(new Error("network")) } satisfies FleetOrganizationMembershipTransport;
		await expect(new FleetOrganizationMembershipAuthority(transport, "acme").directory(_CALLER)).rejects.toMatchObject({ kind: OrganizationMembershipErrorKinds.Unavailable });
	});
});
