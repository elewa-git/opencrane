import type { PrismaClient } from "@prisma/client";
import { OrganizationMembershipDeploymentModes } from "@opencrane/backend/server/iam/organization-members";
import { describe, expect, it } from "vitest";

import { _CreateOrganizationMembersComposition } from "../organization-members-composition";

/** Prisma is retained only by the standalone repository and is not queried during composition. */
const _PRISMA = {} as PrismaClient;

describe("organization membership composition", function _Suite()
{
	it("installs the current-membership product gate only in standalone mode", function _StandaloneGate()
	{
		const composition = _CreateOrganizationMembersComposition(_PRISMA, {
			mode: OrganizationMembershipDeploymentModes.Standalone,
			standalone: {
				invitationSigningKey: Buffer.alloc(32, 7),
				invitationTtlMilliseconds: 60_000,
				publicBaseUrl: "https://acme.example",
			},
		});

		expect(composition.productAccess).toBeTypeOf("function");
	});

	it("leaves Fleet product access on its existing remote-authority path", function _FleetUnchanged()
	{
		const composition = _CreateOrganizationMembersComposition(_PRISMA, {
			mode: OrganizationMembershipDeploymentModes.Fleet,
			fleet: {
				baseUrl: "https://fleet.example",
				credentialSiloId: "acme",
				projectedTokenPath: "/var/run/secrets/fleet/token",
				timeoutMilliseconds: 1_000,
			},
		});

		expect(composition.productAccess).toBeNull();
	});
});
