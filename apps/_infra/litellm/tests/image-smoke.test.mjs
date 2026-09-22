import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readPinnedImage, resolveImageDigest, runImageSmoke, validateReceipt } from "./image-smoke.mjs";

const repository = "ghcr.io/berriai/litellm-non_root";
const reference = `${repository}:main-v1.81.0-stable`;
const digest = `${repository}@sha256:${"a".repeat(64)}`;
const values = `litellm:\n  image:\n    repository: ${repository}\n    tag: main-v1.81.0-stable\n`;
const prefix = "OPENCRANE_LITELLM_RETRY_CONTRACT_V1=";
const receipt = {
  schema: 1,
  routerSha256: "d24726b2f9a0e39d15d0289c2aa121c97c8f5b5441cc14dbf825c6f94f22f78a",
  upstreamCommit: "790a5ce0b323c1eefa70c2df25b2780097aa3f80",
  litellmVersion: "1.81.0",
  openaiVersion: "2.9.0",
  cases: [
    ...["guarded", "defaults", "deployment-override"].flatMap((name, index) =>
      ["429", "500", "timeout", "transport"].map((kind) => ({
        name: `${name}-${kind}`, dispatches: [1, 3, 4][index],
      }))),
    { name: "retry-policy-429", dispatches: 2 },
    { name: "retry-policy-500", dispatches: 1 },
    { name: "retry-policy-timeout", dispatches: 2 },
    { name: "fallback-guarded", dispatches: 1 },
    { name: "fallback-enabled", dispatches: 2 },
  ].sort((left, right) => left.name.localeCompare(right.name, "en")),
  networkAttempts: 0,
};
const encode = (value = receipt) => `${prefix}${JSON.stringify(value)}\n`;
const inspect = (overrides = {}) => JSON.stringify([{
  Os: "linux", Architecture: "amd64", RepoDigests: [digest], ...overrides,
}]);

const fakeDocker = (overrides = {}) => {
  const calls = [];
  const output = [];
  const responses = [
    { status: 0, stdout: "pulled\n", stderr: "" },
    { status: 0, stdout: inspect(), stderr: "" },
    { status: 0, stdout: `dependency log\n${encode()}`, stderr: "" },
  ];
  const options = {
    read: (path, encoding) => {
      assert.equal(path, fileURLToPath(new URL("../../deploy-k8s/values.yaml", import.meta.url)));
      assert.equal(encoding, "utf8");
      return values;
    },
    execute: (args, timeout) => {
      const index = calls.length;
      calls.push({ args, timeout });
      return { ...responses[index], ...overrides[index] };
    },
    write: (text) => output.push(text),
  };
  return { calls, output, options };
};

test("pulls the configured platform, reports its digest, and runs only the offline immutable image", () => {
  const fake = fakeDocker();
  assert.deepEqual(runImageSmoke(fake.options), { digest, receipt });
  assert.equal(fake.calls.length, 3);
  assert.deepEqual(fake.calls[0], {
    args: ["pull", "--platform", "linux/amd64", reference], timeout: 300_000,
  });
  assert.deepEqual(fake.calls[1], {
    args: ["image", "inspect", reference], timeout: 30_000,
  });
  const contractPath = fileURLToPath(new URL("./router-retry-contract.py", import.meta.url));
  assert.deepEqual(fake.calls[2], {
    args: [
      "run", "--rm", "--pull", "never", "--platform", "linux/amd64",
      "--network", "none", "--read-only", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges", "--pids-limit", "256",
      "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m,mode=1777",
      "--env", "PYTHONDONTWRITEBYTECODE=1",
      "--env", "LITELLM_LOCAL_MODEL_COST_MAP=True",
      "--mount", `type=bind,source=${contractPath},target=/opencrane-contract.py,readonly`,
      "--entrypoint", "python", digest, "/opencrane-contract.py",
    ],
    timeout: 180_000,
  });
  const output = fake.output.join("");
  assert.ok(output.includes(`LiteLLM requested image: ${reference}\n`));
  assert.ok(output.includes(`LiteLLM immutable image: ${digest}\n`));
  assert.ok(output.includes(encode()));
  assert.ok(output.endsWith(`LiteLLM offline contract passed: ${digest}\n`));
});

for (const [index, name] of ["pull", "inspect", "run"].entries()) {
  test(`propagates Docker ${name} failure without running later commands`, () => {
    const fake = fakeDocker({ [index]: { status: 23, stdout: "failed\n", stderr: "diagnostic\n" } });
    assert.throws(() => runImageSmoke(fake.options), (error) => error.exitCode === 23);
    assert.equal(fake.calls.length, index + 1);
    assert.ok(fake.output.join("").includes("diagnostic\nfailed\n"));
    assert.ok(!fake.output.join("").includes("offline contract passed"));
  });
}

for (const result of [
  { status: null, error: new Error("spawn failed") },
  { status: 0, signal: "SIGKILL" },
  { status: undefined },
]) {
  test(`rejects an incomplete Docker process result: ${JSON.stringify(result)}`, () => {
    const fake = fakeDocker({ 0: result });
    assert.throws(() => runImageSmoke(fake.options), (error) => error.exitCode === 1);
    assert.equal(fake.calls.length, 1);
  });
}

test("rejects oversized command output", () => {
  const fake = fakeDocker({ 0: { stdout: "x".repeat(4 * 1024 * 1024 + 1) } });
  assert.throws(() => runImageSmoke(fake.options), /output exceeded/);
  assert.equal(fake.calls.length, 1);
});

test("accepts the actual configured repository and version syntax", () => {
  const valuesPath = fileURLToPath(new URL("../../deploy-k8s/values.yaml", import.meta.url));
  assert.deepEqual(readPinnedImage(readFileSync(valuesPath, "utf8")), { repository, reference });
});

for (const [name, source] of [
  ["missing image", "litellm: {}"],
  ["duplicate key", `${values}    tag: main-v1.82.0-stable\n`],
  ["ambiguous registry", values.replace(repository, "berriai/litellm")],
  ["repository option", values.replace(repository, "--privileged")],
  ["repository with digest", values.replace(repository, digest)],
  ["unversioned rolling tag", values.replace("main-v1.81.0-stable", "main-latest")],
  ["numeric tag", values.replace("main-v1.81.0-stable", "123")],
  ["tag with arguments", values.replace("main-v1.81.0-stable", "stable --privileged")],
  ["YAML alias", `base: &image { repository: ${repository}, tag: v1 }\nlitellm: { image: *image }`],
]) {
  test(`rejects ${name} before Docker executes`, () => {
    const fake = fakeDocker();
    assert.throws(() => runImageSmoke({ ...fake.options, read: () => source }));
    assert.equal(fake.calls.length, 0);
  });
}

for (const [name, output] of [
  ["empty inspect", ""],
  ["object instead of array", "{}"],
  ["multiple images", `[${inspect().slice(1, -1)},${inspect().slice(1, -1)}]`],
  ["wrong platform", inspect({ Architecture: "arm64" })],
  ["wrong operating system", inspect({ Os: "windows" })],
  ["missing digest", inspect({ RepoDigests: [] })],
  ["wrong repository", inspect({ RepoDigests: [digest.replace(repository, "ghcr.io/other/image")] })],
  ["malformed digest", inspect({ RepoDigests: [`${repository}@sha256:bad`] })],
  ["duplicate digest", inspect({ RepoDigests: [digest, digest] })],
  ["ambiguous digest", inspect({ RepoDigests: [digest, digest.replace(/a{64}$/, "b".repeat(64))] })],
]) {
  test(`rejects ${name} without running a container`, () => {
    const fake = fakeDocker({ 1: { stdout: output } });
    assert.throws(() => runImageSmoke(fake.options));
    assert.equal(fake.calls.length, 2);
  });
}

test("selects only the requested repository when inspect includes unrelated repository digests", () => {
  assert.equal(resolveImageDigest(inspect({ RepoDigests: [
    digest.replace(repository, "ghcr.io/other/image"), digest,
  ] }), repository), digest);
});

for (const [name, output] of [
  ["empty output", ""],
  ["ordinary success log", "all tests passed\n"],
  ["truncated receipt", encode().slice(0, -10)],
  ["malformed receipt", `${prefix}{not-json}\n`],
  ["prefixed receipt", `log ${encode()}`],
  ["duplicate receipt", `${encode()}${encode()}`],
  ["duplicate object key", encode().replace('"schema":1', '"schema":0,"schema":1')],
  ["missing case", encode({ ...receipt, cases: receipt.cases.slice(1) })],
  ["duplicate case", encode({ ...receipt, cases: [...receipt.cases, receipt.cases[0]] })],
  ["wrong dispatch count", encode({ ...receipt, cases: receipt.cases.map((item, index) =>
    index === 0 ? { ...item, dispatches: 2 } : item) })],
  ["network attempt", encode({ ...receipt, networkAttempts: 1 })],
  ["missing network result", encode({ ...receipt, networkAttempts: undefined })],
  ["wrong router hash", encode({ ...receipt, routerSha256: "a".repeat(64) })],
  ["wrong upstream commit", encode({ ...receipt, upstreamCommit: "a".repeat(40) })],
  ["wrong SDK version", encode({ ...receipt, openaiVersion: "2.10.0" })],
  ["wrong LiteLLM version", encode({ ...receipt, litellmVersion: "1.82.0" })],
  ["extra root field", encode({ ...receipt, skipped: true })],
  ["extra case field", encode({ ...receipt, cases: receipt.cases.map((item) => ({ ...item, skipped: true })) })],
]) {
  test(`rejects successful Docker exit with ${name}`, () => {
    const fake = fakeDocker({ 2: { stdout: output } });
    assert.throws(() => runImageSmoke(fake.options), /receipt/);
    assert.equal(fake.calls.length, 3);
    assert.ok(!fake.output.join("").includes("offline contract passed"));
  });
}

test("rejects a receipt on stderr even when stdout contains a valid receipt", () => {
  const fake = fakeDocker({ 2: { stderr: encode() } });
  assert.throws(() => runImageSmoke(fake.options), /stdout/);
});

test("accepts the complete receipt among harmless dependency logs", () => {
  assert.deepEqual(validateReceipt(`loading dependencies\n${encode()}finished\n`), receipt);
});
