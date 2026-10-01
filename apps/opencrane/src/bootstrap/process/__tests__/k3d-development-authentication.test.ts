import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { _CreateK3dDevelopmentAuthentication } from "../k3d-development-authentication";

describe("k3d development authentication", function _Suite(): void
{
	it("validates the mounted credential before admitting a durable identity", async function _ValidatesCredentialFirst(): Promise<void>
	{
		const directory = mkdtempSync(join(tmpdir(), "opencrane-k3d-auth-"));
		const credentialPath = join(directory, "credential");
		writeFileSync(credentialPath, "invalid-credential");
		const transaction = vi.fn(function _UnexpectedAdmission(): never
		{
			throw new Error("identity admission ran before credential validation");
		});
		const config = {
			credentialPath,
			identity: {
				displayName: "Tier 3 developer",
				email: "developer@example.test",
				issuer: "https://identity.local.opencrane.test",
				siloId: "tier3-test",
				subject: "tier3-developer",
			},
			publicHost: "tier3.local.opencrane.test",
		};

		try
		{
			await expect(_CreateK3dDevelopmentAuthentication({ $transaction: transaction } as never, config, {} as never)).rejects.toThrow(/credential must contain one 32-byte base64url proof/u);
			expect(transaction).not.toHaveBeenCalled();
		}
		finally
		{
			rmSync(directory, { force: true, recursive: true });
		}
	});
});
