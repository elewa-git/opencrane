import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import YAML from "yaml";

const valuesPath = fileURLToPath(new URL("../../deploy-k8s/values.yaml", import.meta.url));
const contractPath = fileURLToPath(new URL("./router-retry-contract.py", import.meta.url));
const producerPath = fileURLToPath(new URL("./preforward-contract.py", import.meta.url));
const sourcePath = fileURLToPath(new URL("../deploy/image-source.json", import.meta.url));
const dockerfilePath = fileURLToPath(new URL("../deploy/Dockerfile", import.meta.url));
const workspacePath = fileURLToPath(new URL("../../../../", import.meta.url));
const receiptPrefix = "OPENCRANE_LITELLM_RETRY_CONTRACT_V1=";
const producerPrefix = "OPENCRANE_LITELLM_PREFORWARD_CONTRACT_V1=";
const contract = "opencrane.preforward-rate-limit.v1";
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const maximumOutputBytes = 4 * 1024 * 1024;
const expectedReceipt = {
  schema: 1,
  routerSha256: "d24726b2f9a0e39d15d0289c2aa121c97c8f5b5441cc14dbf825c6f94f22f78a",
  upstreamCommit: "790a5ce0b323c1eefa70c2df25b2780097aa3f80",
  litellmVersion: "1.81.0",
  openaiVersion: "2.9.0",
  cases: [
    { name: "guarded-429", dispatches: 1 },
    { name: "guarded-500", dispatches: 1 },
    { name: "guarded-timeout", dispatches: 1 },
    { name: "guarded-transport", dispatches: 1 },
    { name: "defaults-429", dispatches: 3 },
    { name: "defaults-500", dispatches: 3 },
    { name: "defaults-timeout", dispatches: 3 },
    { name: "defaults-transport", dispatches: 3 },
    { name: "deployment-override-429", dispatches: 4 },
    { name: "deployment-override-500", dispatches: 4 },
    { name: "deployment-override-timeout", dispatches: 4 },
    { name: "deployment-override-transport", dispatches: 4 },
    { name: "retry-policy-429", dispatches: 2 },
    { name: "retry-policy-500", dispatches: 1 },
    { name: "retry-policy-timeout", dispatches: 2 },
    { name: "fallback-guarded", dispatches: 1 },
    { name: "fallback-enabled", dispatches: 2 },
  ].sort((left, right) => left.name.localeCompare(right.name, "en")),
  networkAttempts: 0,
};
const expectedProducerReceipt = {
  schema: 1, contract,
  cases: [
    { name: "local-limiter", providerCalls: 0, verifiedReceipt: true },
    ...["limiter-reentry-after-dispatch", "postcall-spoof-false", "postcall-spoof-true",
      "provider-200", "provider-418", "provider-500"].map((name) =>
      ({ name, providerCalls: 1, verifiedReceipt: false })),
    ...["auth_mismatch", "deadline", "nonce", "preceding_hook", "tampered-deadlineEpochMs",
      "tampered-logicalFence", "tampered-physicalNonce", "tampered-requestBodySha256",
      "tampered-retryAtEpochMs", "tampered-version", "wrong-mac-key"].map((name) =>
      ({ name, providerCalls: 0, verifiedReceipt: false })),
  ].sort((left, right) =>
  {
    if (left.name === right.name)
      return 0;
    return left.name < right.name ? -1 : 1;
  }),
  networkAttempts: 0,
};

/** Require the pinned contract's full receipt; process exit alone cannot prove its cases ran. */
const validateMatrix = (output, prefix, expected) => {
  const lines = output.split(/\r?\n/).filter((line) => line.includes("OPENCRANE_LITELLM_"));
  if (lines.length !== 1 || !lines[0].startsWith(prefix))
    throw new Error("Missing, duplicate, or malformed LiteLLM contract receipt");
  const encoded = lines[0].slice(prefix.length);
  let receipt;
  try { receipt = JSON.parse(encoded); }
  catch { throw new Error("Malformed LiteLLM contract receipt JSON"); }
  // Compact JSON also rejects duplicate object keys, which JSON.parse would otherwise discard.
  if (JSON.stringify(receipt) !== encoded || !isDeepStrictEqual(receipt, expected))
    throw new Error("LiteLLM contract receipt does not match the complete pinned offline matrix");
  return receipt;
};
export const validateReceipt = (output) => validateMatrix(output, receiptPrefix, expectedReceipt);
export const validateProducerReceipt = (output) => validateMatrix(output, producerPrefix, expectedProducerReceipt);

/** Read the deployed image reference without accepting duplicate YAML keys or aliases. */
export const readPinnedImage = (source) => {
  const document = YAML.parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) throw new Error("Invalid deployment values YAML");
  const image = document.toJS({ maxAliasCount: 0 })?.litellm?.image;
  const repository = image?.repository;
  const tag = image?.tag;
  const digest = image?.digest;
  const repositoryPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]{1,5})?\/[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/;
  if (typeof repository !== "string" || !repositoryPattern.test(repository))
    throw new Error("LiteLLM image repository must be an explicit registry/repository reference");
  const registry = repository.split("/")[0];
  if (!registry.includes(".") && !registry.includes(":") && registry !== "localhost")
    throw new Error("LiteLLM image repository must include an explicit registry");
  if (digest !== undefined && digest !== "") {
    if (typeof digest !== "string" || !digestPattern.test(digest))
      throw new Error("LiteLLM image digest must be an immutable SHA256 reference");
    return { repository, reference: `${repository}@${digest}` };
  }
  if (typeof tag !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)
    || /^(latest|main-latest|main|master|stable|dev|nightly|edge)$/i.test(tag))
    throw new Error("LiteLLM image tag must identify a reviewed version");
  return { repository, reference: `${repository}:${tag}` };
};

/** Keep the derived build's base and inherited runtime identity explicit and reviewable. */
export const readImageSource = (source) => {
  const value = JSON.parse(source);
  const keys = ["schema", "contract", "repository", "tag", "indexDigest", "platformDigest",
    "configDigest", "runtimeUser", "workingDirectory", "entrypoint", "command"];
  if (!value || !isDeepStrictEqual(Object.keys(value).sort(), keys.sort())
    || value.schema !== 1 || value.contract !== contract
    || ![value.indexDigest, value.platformDigest, value.configDigest].every((digest) =>
      typeof digest === "string" && digestPattern.test(digest))
    || value.runtimeUser !== "nobody" || value.workingDirectory !== "/app"
    || !isDeepStrictEqual(value.entrypoint, ["/app/docker/prod_entrypoint.sh"])
    || !isDeepStrictEqual(value.command, ["--port", "4000"]))
    throw new Error("Invalid pinned LiteLLM image source contract");
  readPinnedImage(YAML.stringify({ litellm: { image: value } }));
  return value;
};

/** Select a single Linux/amd64 digest belonging to the repository we just pulled. */
export const resolveImageDigest = (output, repository, configDigest) => {
  let images;
  try { images = JSON.parse(output); }
  catch { throw new Error("Docker inspect did not return valid JSON"); }
  if (!Array.isArray(images) || images.length !== 1
    || images[0]?.Os !== "linux" || images[0]?.Architecture !== "amd64"
    || !Array.isArray(images[0]?.RepoDigests))
    throw new Error("Docker inspect must identify one Linux/amd64 image");
  const matches = images[0].RepoDigests.filter((digest) => typeof digest === "string"
    && digest.startsWith(`${repository}@`));
  if (matches.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(matches[0].slice(repository.length + 1)))
    throw new Error("Docker inspect did not identify one matching immutable repository digest");
  if (configDigest !== undefined && images[0].Id !== configDigest)
    throw new Error("Pulled image configuration does not match the reviewed platform pin");
  return matches[0];
};

/** A locally built image has a content ID, not a published repository digest. */
export const resolveBuiltImage = (output, source) => {
  const images = JSON.parse(output);
  const image = images?.[0];
  if (!Array.isArray(images) || images.length !== 1 || image?.Os !== "linux"
    || image?.Architecture !== "amd64" || typeof image?.Id !== "string"
    || !digestPattern.test(image.Id) || image.Config?.User !== source.runtimeUser
    || image.Config?.WorkingDir !== source.workingDirectory
    || !isDeepStrictEqual(image.Config?.Entrypoint, source.entrypoint)
    || !isDeepStrictEqual(image.Config?.Cmd, source.command)
    || image.Config?.Labels?.["ai.opencrane.litellm.base-digest"] !== source.platformDigest
    || image.Config?.Labels?.["ai.opencrane.litellm.preforward-contract"] !== contract
    || !isDeepStrictEqual(image.Config?.Env?.filter((entry) => entry.startsWith("PYTHONPATH=")),
      ["PYTHONPATH=/opt/opencrane/qualified-model-proxy"]))
    throw new Error("Built LiteLLM image does not match its immutable runtime contract");
  return image.Id;
};

const executeDocker = (args, timeout) => spawnSync("docker", args, {
  encoding: "utf8", timeout, killSignal: "SIGKILL", maxBuffer: maximumOutputBytes,
});

/** Build this checkout and prove both contracts against the same immutable local image. */
export const runImageSmoke = ({
  execute = executeDocker,
  read = readFileSync,
  write = (output) => process.stdout.write(output),
  buildTag = `opencrane-litellm-smoke:${randomUUID()}`,
} = {}) => {
  const { reference } = readPinnedImage(read(valuesPath, "utf8"));
  const source = readImageSource(read(sourcePath, "utf8"));
  const base = `${source.repository}@${source.platformDigest}`;
  if ([contractPath, producerPath].some((path) => path.includes(",")))
    throw new Error("Contract mount path must not contain commas");
  if (!/^opencrane-litellm-smoke:[a-z0-9-]+$/.test(buildTag)) throw new Error("Invalid local smoke image tag");
  const command = (args, timeout) => {
    const result = execute(args, timeout);
    const stdout = typeof result?.stdout === "string" ? result.stdout : "";
    const stderr = typeof result?.stderr === "string" ? result.stderr : "";
    if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > maximumOutputBytes)
      throw new Error("Docker output exceeded the smoke test limit");
    if (stderr) write(stderr.endsWith("\n") ? stderr : `${stderr}\n`);
    if (result?.error || result?.signal || result?.status !== 0) {
      if (stdout) write(stdout.endsWith("\n") ? stdout : `${stdout}\n`);
      const failure = new Error(`Docker ${args[0]} failed${result?.signal ? ` (${result.signal})` : ""}`);
      failure.exitCode = Number.isInteger(result?.status) && result.status > 0 && result.status < 256
        ? result.status : 1;
      throw failure;
    }
    if (stderr.includes("OPENCRANE_LITELLM_"))
      throw new Error("LiteLLM contract receipts must be written to stdout");
    return stdout;
  };

  write(`LiteLLM requested image: ${reference}\n`);
  command(["pull", "--platform", "linux/amd64", base], 300_000);
  const digest = resolveImageDigest(command(["image", "inspect", base], 30_000), source.repository, source.configDigest);
  if (digest !== base) throw new Error("Pulled image digest does not match the reviewed platform pin");
  write(`LiteLLM immutable base: ${digest}\n`);
  const buildOutput = command(["build", "--platform", "linux/amd64", "--network", "none",
    "--tag", buildTag, "--file", dockerfilePath, workspacePath], 600_000);
  if (buildOutput) write(buildOutput.endsWith("\n") ? buildOutput : `${buildOutput}\n`);
  const imageId = resolveBuiltImage(command(["image", "inspect", buildTag], 30_000), source);
  write(`LiteLLM immutable built image: ${imageId}\n`);
  const runContract = (path, validate) => {
    const output = command([
    "run", "--rm", "--pull", "never", "--platform", "linux/amd64",
    "--network", "none", "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--pids-limit", "256",
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m,mode=1777",
    "--env", "PYTHONDONTWRITEBYTECODE=1",
    "--env", "LITELLM_LOCAL_MODEL_COST_MAP=True",
    "--mount", `type=bind,source=${path},target=/opencrane-contract.py,readonly`,
    "--entrypoint", "python", imageId, "/opencrane-contract.py",
  ], 180_000);
    write(output.endsWith("\n") ? output : `${output}\n`);
    return validate(output);
  };
  const receipt = runContract(contractPath, validateReceipt);
  const producerReceipt = runContract(producerPath, validateProducerReceipt);
  write(`LiteLLM offline contracts passed: ${imageId}\n`);
  return { digest, imageId, receipt, producerReceipt };
};

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { runImageSmoke(); }
  catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
