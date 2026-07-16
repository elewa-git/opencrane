import { describe, expect, it } from "vitest";

import {
  _BuildObotClient,
  _NoopObotClient,
  ObotClientNotConfiguredError,
} from "../core/obot-client.js";
import type { ObotManagementClient } from "../core/obot-client.js";

/**
 * The Obot management seam (italanta/opencrane#128, Wave 0 keystone). Until the live
 * HTTP client lands (Wave 1.A), the factory returns a FAIL-CLOSED no-op: unlike the
 * old simulated flow it mints no handle and performs no mutation, so an MCP
 * install/credential/OAuth endpoint can never report success while unconfigured.
 */
describe("Obot management client seam", () =>
{
  it("factory returns the fail-closed no-op until a live client is wired", () =>
  {
    expect(_BuildObotClient()).toBeInstanceOf(_NoopObotClient);
  });

  it("every no-op operation fails closed rather than minting a fake handle", async () =>
  {
    const client: ObotManagementClient = _BuildObotClient();

    // One assertion per surface method: none may resolve to a success value.
    const server = { serverId: "s1", mode: "multiUser" as const };
    await expect(client.upsertCatalogEntry({ catalogId: "c", name: "n", remoteUrl: "https://x", pinnedVersion: "1" })).rejects.toBeInstanceOf(ObotClientNotConfiguredError);
    await expect(client.createServer({ entry: { catalogId: "c", entryId: "e" }, mode: "singleUser" })).rejects.toBeInstanceOf(ObotClientNotConfiguredError);
    await expect(client.configureServer({ server, secrets: { "X-Api-Key": "shh" } })).rejects.toBeInstanceOf(ObotClientNotConfiguredError);
    await expect(client.getServerState(server)).rejects.toBeInstanceOf(ObotClientNotConfiguredError);
    await expect(client.reconcileAccess({ catalogId: "c", resourceId: "e", desired: [] })).rejects.toBeInstanceOf(ObotClientNotConfiguredError);
    await expect(client.listTools(server)).rejects.toBeInstanceOf(ObotClientNotConfiguredError);
    await expect(client.deleteServer(server)).rejects.toBeInstanceOf(ObotClientNotConfiguredError);
    await expect(client.mintClientToken({ ownerObotUserId: "u", tenant: "t" })).rejects.toBeInstanceOf(ObotClientNotConfiguredError);
    await expect(client.revokeClientToken("tok")).rejects.toBeInstanceOf(ObotClientNotConfiguredError);
  });

  it("the not-configured error names the operation and points at the Wave 1.A wiring", async () =>
  {
    const client = _BuildObotClient();
    await expect(client.mintClientToken({ ownerObotUserId: "u", tenant: "t" })).rejects.toThrow(/mint a client token/);
    await expect(client.mintClientToken({ ownerObotUserId: "u", tenant: "t" })).rejects.toThrow(/OBOT_MANAGEMENT_URL/);
  });
});
