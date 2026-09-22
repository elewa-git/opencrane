import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readImageSource, readPinnedImage, resolveBuiltImage, resolveImageDigest, runImageSmoke, validateReceipt, validateProducerReceipt } from "./image-smoke.mjs";

const repository = "ghcr.io/berriai/litellm-non_root";
const reference = `${repository}:main-v1.81.0-stable`;
const source = JSON.parse(readFileSync(new URL("../deploy/image-source.json", import.meta.url), "utf8"));
const digest = `${repository}@${source.platformDigest}`;
const imageId = `sha256:${"c".repeat(64)}`;
const buildTag = "opencrane-litellm-smoke:test";
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
const producerPrefix = "OPENCRANE_LITELLM_PREFORWARD_CONTRACT_V1=";
const producerReceipt = {
  schema: 1, contract: "opencrane.preforward-rate-limit.v1",
  cases: [
    ["auth_mismatch", 0, false], ["deadline", 0, false],
    ["limiter-reentry-after-dispatch", 1, false], ["local-limiter", 0, true],
    ["nonce", 0, false], ["postcall-spoof-false", 1, false], ["postcall-spoof-true", 1, false],
    ["preceding_hook", 0, false], ["provider-200", 1, false], ["provider-418", 1, false],
    ["provider-500", 1, false], ["tampered-deadlineEpochMs", 0, false],
    ["tampered-logicalFence", 0, false], ["tampered-physicalNonce", 0, false],
    ["tampered-requestBodySha256", 0, false], ["tampered-retryAtEpochMs", 0, false],
    ["tampered-version", 0, false], ["wrong-mac-key", 0, false],
  ].map(([name, providerCalls, verifiedReceipt]) => ({ name, providerCalls, verifiedReceipt })),
  networkAttempts: 0,
};
const encodeProducer = (value = producerReceipt) => `${producerPrefix}${JSON.stringify(value)}\n`;
const inspect = (overrides = {}) => JSON.stringify([{
  Id: source.configDigest, Os: "linux", Architecture: "amd64", RepoDigests: [digest], ...overrides,
}]);
const builtConfig = {
  User: "nobody", WorkingDir: "/app", Entrypoint: ["/app/docker/prod_entrypoint.sh"],
  Cmd: ["--port", "4000"], Env: ["PATH=/usr/bin", "PYTHONPATH=/opt/opencrane/qualified-model-proxy"],
  Labels: { "ai.opencrane.litellm.base-digest": source.platformDigest,
    "ai.opencrane.litellm.preforward-contract": producerReceipt.contract },
};
const inspectBuilt = (overrides = {}) => JSON.stringify([{
  Id: imageId, Os: "linux", Architecture: "amd64", Config: builtConfig, ...overrides,
}]);

const fakeDocker = (overrides = {}) => {
  const calls = [];
  const output = [];
  const responses = [
    { status: 0, stdout: "pulled\n", stderr: "" },
    { status: 0, stdout: inspect(), stderr: "" },
    { status: 0, stdout: "built\n", stderr: "" },
    { status: 0, stdout: inspectBuilt(), stderr: "" },
    { status: 0, stdout: `dependency log\n${encode()}`, stderr: "" },
    { status: 0, stdout: encodeProducer(), stderr: "" },
  ];
  const options = {
    read: (path, encoding) => {
      assert.equal(encoding, "utf8");
      if (path === fileURLToPath(new URL("../../deploy-k8s/values.yaml", import.meta.url))) return values;
      assert.equal(path, fileURLToPath(new URL("../deploy/image-source.json", import.meta.url)));
      return JSON.stringify(source);
    },
    buildTag,
    execute: (args, timeout) => {
      const index = calls.length;
      calls.push({ args, timeout });
      return { ...responses[index], ...overrides[index] };
    },
    write: (text) => output.push(text),
  };
  return { calls, output, options };
};

test("builds this checkout from the pinned base and proves both contracts on the immutable offline image", () => {
  const fake = fakeDocker();
  assert.deepEqual(runImageSmoke(fake.options), { digest, imageId, receipt, producerReceipt });
  assert.equal(fake.calls.length, 6);
  assert.deepEqual(fake.calls[0], {
    args: ["pull", "--platform", "linux/amd64", digest], timeout: 300_000,
  });
  assert.deepEqual(fake.calls[1], {
    args: ["image", "inspect", digest], timeout: 30_000,
  });
  assert.deepEqual(fake.calls[2], {
    args: ["build", "--platform", "linux/amd64", "--network", "none", "--tag", buildTag,
      "--file", fileURLToPath(new URL("../deploy/Dockerfile", import.meta.url)),
      fileURLToPath(new URL("../../../../", import.meta.url))], timeout: 600_000,
  });
  assert.deepEqual(fake.calls[3], { args: ["image", "inspect", buildTag], timeout: 30_000 });
  for (const [index, name] of ["router-retry-contract.py", "preforward-contract.py"].entries()) {
    const contractPath = fileURLToPath(new URL(`./${name}`, import.meta.url));
    assert.deepEqual(fake.calls[index + 4], {
    args: [
      "run", "--rm", "--pull", "never", "--platform", "linux/amd64",
      "--network", "none", "--read-only", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges", "--pids-limit", "256",
      "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m,mode=1777",
      "--env", "PYTHONDONTWRITEBYTECODE=1",
      "--env", "LITELLM_LOCAL_MODEL_COST_MAP=True",
      "--mount", `type=bind,source=${contractPath},target=/opencrane-contract.py,readonly`,
      "--entrypoint", "python", imageId, "/opencrane-contract.py",
    ],
    timeout: 180_000,
  });
  }
  const output = fake.output.join("");
  assert.ok(output.includes(`LiteLLM requested image: ${reference}\n`));
  assert.ok(output.includes(`LiteLLM immutable base: ${digest}\n`));
  assert.ok(output.includes(`LiteLLM immutable built image: ${imageId}\n`));
  assert.ok(output.includes(encode()));
  assert.ok(output.includes(encodeProducer()));
  assert.ok(output.endsWith(`LiteLLM offline contracts passed: ${imageId}\n`));
});

for (const [index, name] of ["pull", "base inspect", "build", "built inspect", "router run", "producer run"].entries()) {
  test(`propagates Docker ${name} failure without running later commands`, () => {
    const fake = fakeDocker({ [index]: { status: 23, stdout: "failed\n", stderr: "diagnostic\n" } });
    assert.throws(() => runImageSmoke(fake.options), (error) => error.exitCode === 23);
    assert.equal(fake.calls.length, index + 1);
    assert.ok(fake.output.join("").includes("diagnostic\nfailed\n"));
    assert.ok(!fake.output.join("").includes("offline contracts passed"));
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
  ["ambiguous digest", inspect({ RepoDigests: [digest, `${repository}@sha256:${"b".repeat(64)}`] })],
  ["wrong base configuration", inspect({ Id: `sha256:${"b".repeat(64)}` })],
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
    const fake = fakeDocker({ 4: { stdout: output } });
    assert.throws(() => runImageSmoke(fake.options), /receipt/);
    assert.equal(fake.calls.length, 5);
    assert.ok(!fake.output.join("").includes("offline contracts passed"));
  });
}

test("rejects a receipt on stderr even when stdout contains a valid receipt", () => {
  const fake = fakeDocker({ 4: { stderr: encode() } });
  assert.throws(() => runImageSmoke(fake.options), /stdout/);
});

test("accepts the complete receipt among harmless dependency logs", () => {
  assert.deepEqual(validateReceipt(`loading dependencies\n${encode()}finished\n`), receipt);
});

test("accepts an explicit published deployment digest without changing the source-built smoke image", () => {
  assert.deepEqual(readPinnedImage(`${values}    digest: sha256:${"d".repeat(64)}\n`),
    { repository, reference: `${repository}@sha256:${"d".repeat(64)}` });
});

for (const [name, change] of [
  ["unknown schema", { schema: 2 }], ["missing pin", { platformDigest: undefined }],
  ["invalid digest", { configDigest: "latest" }], ["root user", { runtimeUser: "root" }],
  ["changed startup", { entrypoint: ["python"] }], ["extra field", { skipped: true }],
  ["wrong contract", { contract: "other" }],
]) test(`rejects source metadata with ${name}`, () => {
  assert.throws(() => readImageSource(JSON.stringify({ ...source, ...change })));
});

for (const [name, output] of [
  ["missing immutable ID", inspectBuilt({ Id: undefined })],
  ["mutable ID", inspectBuilt({ Id: buildTag })],
  ["wrong architecture", inspectBuilt({ Architecture: "arm64" })],
  ["root runtime", inspectBuilt({ Config: { ...builtConfig, User: "root" } })],
  ["wrong startup", inspectBuilt({ Config: { ...builtConfig, Cmd: ["sleep", "1"] } })],
  ["missing owned package", inspectBuilt({ Config: { ...builtConfig, Env: [] } })],
  ["ambiguous owned package", inspectBuilt({ Config: { ...builtConfig, Env: [...builtConfig.Env, "PYTHONPATH=/other"] } })],
  ["missing binding label", inspectBuilt({ Config: { ...builtConfig, Labels: {} } })],
]) test(`rejects built image with ${name} before running either harness`, () => {
  const fake = fakeDocker({ 3: { stdout: output } });
  assert.throws(() => runImageSmoke(fake.options));
  assert.equal(fake.calls.length, 4);
});

test("rejects a different valid base digest", () => {
  const fake = fakeDocker({ 1: { stdout: inspect({ RepoDigests: [`${repository}@sha256:${"e".repeat(64)}`] }) } });
  assert.throws(() => runImageSmoke(fake.options), /reviewed platform pin/);
  assert.equal(fake.calls.length, 2);
});

for (const [name, output] of [
  ["empty producer output", ""], ["truncated producer receipt", encodeProducer().slice(0, -10)],
  ["source fixture instead of installed binding", encodeProducer().replace("CONTRACT_V1", "SOURCE_V1")],
  ["duplicate producer receipt", encodeProducer() + encodeProducer()],
  ["malformed producer receipt", `${producerPrefix}{bad}\n`],
  ["missing producer case", encodeProducer({ ...producerReceipt, cases: producerReceipt.cases.slice(1) })],
  ["duplicate producer case", encodeProducer({ ...producerReceipt, cases: [...producerReceipt.cases, producerReceipt.cases[0]] })],
  ["producer network attempt", encodeProducer({ ...producerReceipt, networkAttempts: 1 })],
  ["unproved local rejection", encodeProducer({ ...producerReceipt, cases: producerReceipt.cases.map((item) =>
    ({ ...item, verifiedReceipt: false })) })],
  ["hidden provider call", encodeProducer({ ...producerReceipt, cases: producerReceipt.cases.map((item) =>
    item.name === "local-limiter" ? { ...item, providerCalls: 1 } : item) })],
  ["wrong producer contract", encodeProducer({ ...producerReceipt, contract: "other" })],
  ["duplicate producer key", encodeProducer().replace('"schema":1', '"schema":0,"schema":1')],
]) test(`rejects successful Docker exit with ${name}`, () => {
  const fake = fakeDocker({ 5: { stdout: output } });
  assert.throws(() => runImageSmoke(fake.options), /receipt/);
  assert.equal(fake.calls.length, 6);
  assert.ok(!fake.output.join("").includes("offline contracts passed"));
});

test("rejects a producer receipt on stderr", () => {
  const fake = fakeDocker({ 5: { stderr: encodeProducer() } });
  assert.throws(() => runImageSmoke(fake.options), /stdout/);
});

test("accepts the complete actual-image producer receipt and built image ID", () => {
  assert.deepEqual(validateProducerReceipt(encodeProducer()), producerReceipt);
  assert.equal(resolveBuiltImage(inspectBuilt(), source), imageId);
});
