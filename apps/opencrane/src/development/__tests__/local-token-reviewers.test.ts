import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE, AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME } from "@opencrane/contracts";

import { _CreateDevelopmentControllerTokenReviewer } from "../local-token-reviewers";

/** Temporary directories removed after each token-review test. */
const _directories: string[] = [];

/** Write one private launch secret and remember its directory for cleanup. */
async function _PrivateSecret(value: string): Promise<string>
{
	const directory = await mkdtemp(join(tmpdir(), "opencrane-controller-reviewer-"));
	const path = join(directory, "controller.token");
	_directories.push(directory);
	await writeFile(path, value, {
		encoding: "utf8",
		mode: 0o600
	});
	return path;
}

afterEach(async function _RemoveSecrets(): Promise<void>
{
	await Promise.all(_directories.splice(0).map(directory => rm(directory, {
		recursive: true,
		force: true
	})));
});

describe("Tier 2 controller bearer review", function _Suite()
{
	it("returns the fixed controller identity only for the per-launch bearer", async function _AcceptsLaunchBearer(): Promise<void>
	{
		const token = randomBytes(32).toString("base64url");
		const reviewer = await _CreateDevelopmentControllerTokenReviewer(await _PrivateSecret(token), "local-development-server");
		await expect(reviewer.__Review("wrong-token")).resolves.toBeNull();
		await expect(reviewer.__Review(token)).resolves.toEqual({
			username: `system:serviceaccount:local-development-server:${AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME}`,
			namespace: "local-development-server",
			serviceAccountName: AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME,
			audiences: [AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE]
		});
	});

	it("refuses a bearer file readable by another local account", async function _RejectsBroadPermissions(): Promise<void>
	{
		const path = await _PrivateSecret(randomBytes(32).toString("base64url"));
		await chmod(path, 0o644);
		await expect(_CreateDevelopmentControllerTokenReviewer(path, "local-development-server")).rejects.toThrow(/owner-only permissions/);
	});
});
