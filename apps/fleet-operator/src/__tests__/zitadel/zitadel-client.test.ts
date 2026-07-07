import crypto from "node:crypto";

import { beforeEach, afterEach, describe, expect, it } from "vitest";

import { _BuildZitadelManagementClient, _DeriveOrgRedirectUri, _DeriveVanityRedirectUri, _HttpZitadelManagementClient, _ReadZitadelClientConfig } from "../../infra/zitadel/zitadel-client.js";

/** A real RSA SA key so the client's RS256 jwt-bearer signing actually succeeds. */
function _saKeyJson(): string
{
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  return JSON.stringify({ type: "serviceaccount", keyId: "k1", key: pem, userId: "u1" });
}

/** Build an injectable fetch fake that records calls and replies per path. */
function _fakeFetch(overrides: Record<string, { status?: number; body?: unknown }> = {}): { fetchImpl: typeof fetch; calls: Array<{ method: string; path: string; orgId?: string; body?: Record<string, unknown> }> }
{
  const calls: Array<{ method: string; path: string; orgId?: string; body?: Record<string, unknown> }> = [];
  const fetchImpl = (async function _f(url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown }) {
    const path = url.replace(/^https:\/\/[^/]+/, "");
    // The JSON management calls send a stringified object body; the token call sends
    // URLSearchParams — only parse the former so assertions can read redirectUris etc.
    const parsedBody = typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    calls.push({ method: init?.method ?? "GET", path, orgId: init?.headers?.["x-zitadel-orgid"], body: parsedBody });
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    const o = overrides[path];
    if (o) return { ok: (o.status ?? 200) < 400, status: o.status ?? 200, json: async () => o.body ?? {}, text: async () => JSON.stringify(o.body ?? {}) };
    if (path === "/oauth/v2/token") return ok({ access_token: "tok-abc", expires_in: 3600 });
    if (path === "/v2/organizations") return ok({ organizationId: "org-9" });
    if (path === "/management/v1/projects") return ok({ id: "proj-9" });
    if (path.endsWith("/roles/_bulk")) return ok({});
    if (path.endsWith("/apps/oidc")) return ok({ appId: "app-9", clientId: "client-9" });
    if (path.includes("/grants")) return ok({});
    if (path.startsWith("/admin/v1/orgs/")) return ok({});
    return ok({});
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("_HttpZitadelManagementClient — live provisioning lifecycle (injected fetch)", function _liveSuite()
{
  it("provisions org → project → roles → app → master grant, in order, returning the ids", async function _provisions()
  {
    const { fetchImpl, calls } = _fakeFetch();
    const client = new _HttpZitadelManagementClient({ apiUrl: "https://z.example.com", serviceAccountKey: _saKeyJson(), baseDomain: "dev.opencrane.ai" }, fetchImpl);

    const result = await client.provisionOrg({ orgName: "acme", displayName: "Acme", redirectUri: "https://acme.dev.opencrane.ai/api/v1/auth/callback", masterSubject: "u-master" });

    expect(result).toEqual({ orgId: "org-9", projectId: "proj-9", appId: "app-9", clientId: "client-9", redirectUri: "https://acme.dev.opencrane.ai/api/v1/auth/callback" });
    const paths = calls.map(c => c.path);
    expect(paths).toEqual([
      "/oauth/v2/token",
      "/v2/organizations",
      "/management/v1/projects",
      "/management/v1/projects/proj-9/roles/_bulk",
      "/management/v1/projects/proj-9/apps/oidc",
      "/management/v1/users/u-master/grants",
      "/management/v1/orgs/me/members",
    ]);
    // Every in-org call carries the new org's context header.
    expect(calls.filter(c => c.path.startsWith("/management")).every(c => c.orgId === "org-9")).toBe(true);
    // With no vanity domain, only the canonical callback is registered on the app.
    const appCreate = calls.find(c => c.path.endsWith("/apps/oidc"));
    expect(appCreate?.body?.redirectUris).toEqual(["https://acme.dev.opencrane.ai/api/v1/auth/callback"]);
  });

  it("registers the vanity callback alongside the canonical one when a vanity domain is given (S3b)", async function _provisionsVanity()
  {
    const { fetchImpl, calls } = _fakeFetch();
    const client = new _HttpZitadelManagementClient({ apiUrl: "https://z.example.com", serviceAccountKey: _saKeyJson(), baseDomain: "dev.opencrane.ai" }, fetchImpl);

    await client.provisionOrg({
      orgName: "acme", displayName: "Acme",
      redirectUri: "https://acme.dev.opencrane.ai/api/v1/auth/callback",
      vanityRedirectUri: "https://ai.acme.com/api/v1/auth/callback",
      masterSubject: "u-master",
    });

    const appCreate = calls.find(c => c.path.endsWith("/apps/oidc"));
    expect(appCreate?.body?.redirectUris).toEqual([
      "https://acme.dev.opencrane.ai/api/v1/auth/callback",
      "https://ai.acme.com/api/v1/auth/callback",
    ]);
  });

  it("setAppRedirectUris PUTs the full URI set to the org-scoped oidc_config endpoint (S3b)", async function _setRedirects()
  {
    const { fetchImpl, calls } = _fakeFetch();
    const client = new _HttpZitadelManagementClient({ apiUrl: "https://z.example.com", serviceAccountKey: _saKeyJson(), baseDomain: "dev.opencrane.ai" }, fetchImpl);

    await client.setAppRedirectUris({
      orgId: "org-9", projectId: "proj-9", appId: "app-9",
      redirectUris: ["https://acme.dev.opencrane.ai/api/v1/auth/callback", "https://ai.acme.com/api/v1/auth/callback"],
    });

    const put = calls.find(c => c.method === "PUT");
    expect(put?.path).toBe("/management/v1/projects/proj-9/apps/app-9/oidc_config");
    expect(put?.orgId).toBe("org-9");
    expect(put?.body?.redirectUris).toEqual([
      "https://acme.dev.opencrane.ai/api/v1/auth/callback",
      "https://ai.acme.com/api/v1/auth/callback",
    ]);
  });

  it("compensates (deletes the half-created org) and rethrows when a later step fails", async function _compensates()
  {
    const { fetchImpl, calls } = _fakeFetch({ "/management/v1/projects/proj-9/apps/oidc": { status: 500, body: { message: "boom" } } });
    const client = new _HttpZitadelManagementClient({ apiUrl: "https://z.example.com", serviceAccountKey: _saKeyJson(), baseDomain: "dev.opencrane.ai" }, fetchImpl);

    await expect(client.provisionOrg({ orgName: "acme", displayName: "Acme", redirectUri: "https://acme.dev.opencrane.ai/api/v1/auth/callback", masterSubject: "u-master" })).rejects.toThrow(/apps\/oidc failed \(500\)/);
    // The compensating org delete ran.
    expect(calls.some(c => c.method === "DELETE" && c.path === "/admin/v1/orgs/org-9")).toBe(true);
  });

  it("fails loud (and compensates) when the app-create response omits the clientId (S3b)", async function _noClientId()
  {
    // The live app-create returns appId + clientId; an app row without a clientId would
    // leave the org with a login surface but no per-org credential, so we reject it.
    const { fetchImpl, calls } = _fakeFetch({ "/management/v1/projects/proj-9/apps/oidc": { status: 200, body: { appId: "app-9" } } });
    const client = new _HttpZitadelManagementClient({ apiUrl: "https://z.example.com", serviceAccountKey: _saKeyJson(), baseDomain: "dev.opencrane.ai" }, fetchImpl);

    await expect(client.provisionOrg({ orgName: "acme", displayName: "Acme", redirectUri: "https://acme.dev.opencrane.ai/api/v1/auth/callback", masterSubject: "u-master" })).rejects.toThrow(/no clientId/);
    expect(calls.some(c => c.method === "DELETE" && c.path === "/admin/v1/orgs/org-9")).toBe(true);
  });

  it("grantProjectRole POSTs the org-scoped user grant with the given project role (#126 S3)", async function _grantRole()
  {
    const { fetchImpl, calls } = _fakeFetch();
    const client = new _HttpZitadelManagementClient({ apiUrl: "https://z.example.com", serviceAccountKey: _saKeyJson(), baseDomain: "d" }, fetchImpl);

    await client.grantProjectRole("org-9", "proj-9", "user-2", "member");

    const grant = calls.find(c => c.path === "/management/v1/users/user-2/grants");
    expect(grant?.method).toBe("POST");
    expect(grant?.orgId).toBe("org-9");
    expect(grant?.body).toEqual({ projectId: "proj-9", roleKeys: ["member"] });
  });

  it("grantProjectRole throws on a non-OK Zitadel response (rolls a wrapping DB tx back)", async function _grantFails()
  {
    const { fetchImpl } = _fakeFetch({ "/management/v1/users/user-2/grants": { status: 500, body: { message: "boom" } } });
    const client = new _HttpZitadelManagementClient({ apiUrl: "https://z.example.com", serviceAccountKey: _saKeyJson(), baseDomain: "d" }, fetchImpl);

    await expect(client.grantProjectRole("org-9", "proj-9", "user-2", "member")).rejects.toThrow(/grants failed \(500\)/);
  });

  it("listOrgUsers POSTs the org-scoped user search and maps result → { subject, email } (#126 S4b)", async function _listUsers()
  {
    const { fetchImpl, calls } = _fakeFetch({
      "/management/v1/users/_search": { status: 200, body: { result: [
        { userId: "u-1", human: { email: { email: "a@acme.test" } } },
        { id: "u-2" },                       // no `human` block → email omitted
        { human: { email: { email: "ghost@acme.test" } } }, // no id/userId → dropped
      ] } },
    });
    const client = new _HttpZitadelManagementClient({ apiUrl: "https://z.example.com", serviceAccountKey: _saKeyJson(), baseDomain: "d" }, fetchImpl);

    const users = await client.listOrgUsers("org-9");

    const search = calls.find(c => c.path === "/management/v1/users/_search");
    expect(search?.method).toBe("POST");
    expect(search?.orgId).toBe("org-9");
    // Entries without a subject are dropped; email is carried through when present.
    expect(users).toEqual([{ subject: "u-1", email: "a@acme.test" }, { subject: "u-2" }]);
  });

  it("listOrgUsers tolerates a response with no result array (returns [])", async function _listUsersEmpty()
  {
    const { fetchImpl } = _fakeFetch({ "/management/v1/users/_search": { status: 200, body: {} } });
    const client = new _HttpZitadelManagementClient({ apiUrl: "https://z.example.com", serviceAccountKey: _saKeyJson(), baseDomain: "d" }, fetchImpl);
    await expect(client.listOrgUsers("org-9")).resolves.toEqual([]);
  });

  it("removeOrgMember DELETEs the org-scoped membership (#126 S4d)", async function _removeMember()
  {
    const { fetchImpl, calls } = _fakeFetch();
    const client = new _HttpZitadelManagementClient({ apiUrl: "https://z.example.com", serviceAccountKey: _saKeyJson(), baseDomain: "d" }, fetchImpl);

    await client.removeOrgMember("org-9", "user-2");

    const del = calls.find(c => c.path === "/management/v1/orgs/me/members/user-2");
    expect(del?.method).toBe("DELETE");
    expect(del?.orgId).toBe("org-9");
  });

  it("removeOrgMember throws on a non-OK Zitadel response (offboarding keeps the local row)", async function _removeMemberFails()
  {
    const { fetchImpl } = _fakeFetch({ "/management/v1/orgs/me/members/user-2": { status: 500, body: { message: "boom" } } });
    const client = new _HttpZitadelManagementClient({ apiUrl: "https://z.example.com", serviceAccountKey: _saKeyJson(), baseDomain: "d" }, fetchImpl);
    await expect(client.removeOrgMember("org-9", "user-2")).rejects.toThrow(/members\/user-2 failed \(500\)/);
  });

  it("teardownOrg tolerates an already-absent org (404)", async function _teardown404()
  {
    const { fetchImpl } = _fakeFetch({ "/admin/v1/orgs/gone": { status: 404, body: {} } });
    const client = new _HttpZitadelManagementClient({ apiUrl: "https://z.example.com", serviceAccountKey: _saKeyJson(), baseDomain: "dev.opencrane.ai" }, fetchImpl);
    await expect(client.teardownOrg("gone")).resolves.toBeUndefined();
  });

  it("rejects a malformed service-account key", function _badKey()
  {
    expect(() => new _HttpZitadelManagementClient({ apiUrl: "https://z.example.com", serviceAccountKey: "{}", baseDomain: "d" })).toThrow(/service-account key/);
  });
});

describe("_HttpZitadelManagementClient.validateCandidateKey — safe-rotation gate (injected fetch)", function _validateSuite()
{
  /** A candidate-validation fetch fake: token exchange + the instance IAM_OWNER probe. */
  function _validatorFetch(opts: { tokenStatus?: number; tokenBody?: unknown; probeStatus?: number } = {}): { fetchImpl: typeof fetch; calls: string[] }
  {
    const calls: string[] = [];
    const fetchImpl = (async function _f(url: string, init: { method?: string }) {
      const path = url.replace(/^https:\/\/[^/]+/, "");
      calls.push(`${init?.method ?? "GET"} ${path}`);
      if (path === "/oauth/v2/token")
      {
        const status = opts.tokenStatus ?? 200;
        const body = opts.tokenBody ?? { access_token: "cand-tok", expires_in: 3600 };
        return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) };
      }
      if (path === "/admin/v1/instances/me")
      {
        const status = opts.probeStatus ?? 200;
        return { ok: status < 400, status, json: async () => ({}), text: async () => "{}" };
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }

  it("returns both flags true when the token exchange AND the instance IAM_OWNER probe succeed", async function _bothOk()
  {
    const { fetchImpl, calls } = _validatorFetch({});
    const client = new _HttpZitadelManagementClient({ apiUrl: "https://z.example.com", serviceAccountKey: _saKeyJson(), baseDomain: "d" }, fetchImpl);

    const result = await client.validateCandidateKey(_saKeyJson());

    expect(result.tokenExchangeOk).toBe(true);
    expect(result.instanceScopeOk).toBe(true);
    expect(result.keyId).toBe("k1");
    // The probe is the read-only Admin API instance read (org-managers can't call it).
    expect(calls).toContain("GET /admin/v1/instances/me");
  });

  it("returns tokenExchangeOk=false (and skips the probe) when the token exchange fails", async function _tokenFail()
  {
    const { fetchImpl, calls } = _validatorFetch({ tokenStatus: 401 });
    const client = new _HttpZitadelManagementClient({ apiUrl: "https://z.example.com", serviceAccountKey: _saKeyJson(), baseDomain: "d" }, fetchImpl);

    const result = await client.validateCandidateKey(_saKeyJson());

    expect(result.tokenExchangeOk).toBe(false);
    expect(result.instanceScopeOk).toBe(false);
    // A failed token exchange must short-circuit — the IAM_OWNER probe is never attempted.
    expect(calls).not.toContain("GET /admin/v1/instances/me");
  });

  it("returns instanceScopeOk=false when the key authenticates but lacks instance IAM_OWNER (403)", async function _scopeFail()
  {
    const { fetchImpl } = _validatorFetch({ probeStatus: 403 });
    const client = new _HttpZitadelManagementClient({ apiUrl: "https://z.example.com", serviceAccountKey: _saKeyJson(), baseDomain: "d" }, fetchImpl);

    const result = await client.validateCandidateKey(_saKeyJson());

    expect(result.tokenExchangeOk).toBe(true);
    expect(result.instanceScopeOk).toBe(false);
  });

  it("flags a malformed candidate key (no throw) and never touches the network", async function _malformed()
  {
    const { fetchImpl, calls } = _validatorFetch({});
    const client = new _HttpZitadelManagementClient({ apiUrl: "https://z.example.com", serviceAccountKey: _saKeyJson(), baseDomain: "d" }, fetchImpl);

    const result = await client.validateCandidateKey("{}");

    expect(result).toEqual({ tokenExchangeOk: false, instanceScopeOk: false, keyId: null, detail: expect.stringContaining("malformed") });
    expect(calls).toHaveLength(0);
  });

  it("does NOT mutate the live key/token cache while validating a candidate", async function _noMutation()
  {
    const { fetchImpl } = _validatorFetch({});
    const liveKey = _saKeyJson();
    const client = new _HttpZitadelManagementClient({ apiUrl: "https://z.example.com", serviceAccountKey: liveKey, baseDomain: "d" }, fetchImpl);

    const before = client.currentKeyId();
    await client.validateCandidateKey(_saKeyJson()); // a DIFFERENT key (fresh keypair, same keyId "k1")
    expect(client.currentKeyId()).toBe(before);
  });

  it("reloadKey swaps the live key id and rejects a malformed key", async function _reload()
  {
    const { fetchImpl } = _validatorFetch({});
    const client = new _HttpZitadelManagementClient({ apiUrl: "https://z.example.com", serviceAccountKey: _saKeyJson(), baseDomain: "d" }, fetchImpl);

    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    client.reloadKey(JSON.stringify({ type: "serviceaccount", keyId: "k2", key: pem, userId: "u2" }));
    expect(client.currentKeyId()).toBe("k2");

    expect(() => client.reloadKey("{}")).toThrow(/service-account key/);
  });
});

describe("_DeriveOrgRedirectUri", function _deriveSuite()
{
  it("derives the per-org callback URI from the org name + base domain", function _derives()
  {
    expect(_DeriveOrgRedirectUri("elewa-be", "dev.opencrane.ai")).toBe("https://elewa-be.dev.opencrane.ai/api/v1/auth/callback");
  });
});

describe("_DeriveVanityRedirectUri", function _deriveVanitySuite()
{
  it("derives the vanity callback URI from the full vanity host (no base appended)", function _derivesVanity()
  {
    expect(_DeriveVanityRedirectUri("ai.client-company.com")).toBe("https://ai.client-company.com/api/v1/auth/callback");
  });
});

describe("_ReadZitadelClientConfig + factory — hard-required, fail-loud when unconfigured", function _configSuite()
{
  let _saved: NodeJS.ProcessEnv;
  beforeEach(function _save() { _saved = process.env; process.env = { ..._saved }; });
  afterEach(function _restore() { process.env = _saved; });

  it("returns null config when any required var is missing", function _partial()
  {
    process.env.ZITADEL_MGMT_API_URL = "https://zitadel.example.com";
    delete process.env.ZITADEL_MGMT_SA_KEY;
    delete process.env.PLATFORM_BASE_DOMAIN;
    expect(_ReadZitadelClientConfig()).toBeNull();
  });

  it("reads a complete config (no shared projectId — each org gets its own)", function _complete()
  {
    process.env.ZITADEL_MGMT_API_URL = "https://zitadel.example.com";
    process.env.ZITADEL_MGMT_SA_KEY = "{\"type\":\"serviceaccount\"}";
    process.env.PLATFORM_BASE_DOMAIN = "dev.opencrane.ai";
    expect(_ReadZitadelClientConfig()).toEqual({
      apiUrl: "https://zitadel.example.com",
      serviceAccountKey: "{\"type\":\"serviceaccount\"}",
      baseDomain: "dev.opencrane.ai",
    });
  });

  it("factory THROWS when unconfigured (hard commit — never a silent no-op)", function _factoryThrows()
  {
    delete process.env.ZITADEL_MGMT_API_URL;
    delete process.env.ZITADEL_MGMT_SA_KEY;
    delete process.env.PLATFORM_BASE_DOMAIN;
    expect(() => _BuildZitadelManagementClient()).toThrow(/Zitadel management is required/);
  });
});
