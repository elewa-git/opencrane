import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import YAML from "yaml";

const valuesPath = fileURLToPath(new URL("../../deploy-k8s/values.yaml", import.meta.url));
const contractPath = fileURLToPath(new URL("./router-retry-contract.py", import.meta.url));
const receiptPrefix = "OPENCRANE_LITELLM_RETRY_CONTRACT_V1=";
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

/** Require the pinned contract's full receipt; process exit alone cannot prove its cases ran. */
export const validateReceipt = (output) => {
  const lines = output.split(/\r?\n/).filter((line) => line.includes("OPENCRANE_LITELLM_RETRY_CONTRACT"));
  if (lines.length !== 1 || !lines[0].startsWith(receiptPrefix))
    throw new Error("Missing, duplicate, or malformed LiteLLM contract receipt");
  const encoded = lines[0].slice(receiptPrefix.length);
  let receipt;
  try { receipt = JSON.parse(encoded); }
  catch { throw new Error("Malformed LiteLLM contract receipt JSON"); }
  // Compact JSON also rejects duplicate object keys, which JSON.parse would otherwise discard.
  if (JSON.stringify(receipt) !== encoded || !isDeepStrictEqual(receipt, expectedReceipt))
    throw new Error("LiteLLM contract receipt does not match the complete pinned offline matrix");
  return receipt;
};

/** Read the deployed image reference without accepting duplicate YAML keys or aliases. */
export const readPinnedImage = (source) => {
  const document = YAML.parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) throw new Error("Invalid deployment values YAML");
  const image = document.toJS({ maxAliasCount: 0 })?.litellm?.image;
  const repository = image?.repository;
  const tag = image?.tag;
  const repositoryPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]{1,5})?\/[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/;
  if (typeof repository !== "string" || !repositoryPattern.test(repository))
    throw new Error("LiteLLM image repository must be an explicit registry/repository reference");
  const registry = repository.split("/")[0];
  if (!registry.includes(".") && !registry.includes(":") && registry !== "localhost")
    throw new Error("LiteLLM image repository must include an explicit registry");
  if (typeof tag !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)
    || /^(latest|main-latest|main|master|stable|dev|nightly|edge)$/i.test(tag))
    throw new Error("LiteLLM image tag must identify a reviewed version");
  return { repository, reference: `${repository}:${tag}` };
};

/** Select a single Linux/amd64 digest belonging to the repository we just pulled. */
export const resolveImageDigest = (output, repository) => {
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
  return matches[0];
};

const executeDocker = (args, timeout) => spawnSync("docker", args, {
  encoding: "utf8", timeout, killSignal: "SIGKILL", maxBuffer: maximumOutputBytes,
});

/** Pull once, identify the immutable image, and require its complete offline test receipt. */
export const runImageSmoke = ({
  execute = executeDocker,
  read = readFileSync,
  write = (output) => process.stdout.write(output),
} = {}) => {
  const { repository, reference } = readPinnedImage(read(valuesPath, "utf8"));
  if (contractPath.includes(",")) throw new Error("Contract mount path must not contain commas");
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
    if (stderr.includes("OPENCRANE_LITELLM_RETRY_CONTRACT"))
      throw new Error("LiteLLM contract receipts must be written to stdout");
    return stdout;
  };

  write(`LiteLLM requested image: ${reference}\n`);
  command(["pull", "--platform", "linux/amd64", reference], 300_000);
  const digest = resolveImageDigest(command(["image", "inspect", reference], 30_000), repository);
  write(`LiteLLM immutable image: ${digest}\n`);
  const output = command([
    "run", "--rm", "--pull", "never", "--platform", "linux/amd64",
    "--network", "none", "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--pids-limit", "256",
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m,mode=1777",
    "--env", "PYTHONDONTWRITEBYTECODE=1",
    "--env", "LITELLM_LOCAL_MODEL_COST_MAP=True",
    "--mount", `type=bind,source=${contractPath},target=/opencrane-contract.py,readonly`,
    "--entrypoint", "python", digest, "/opencrane-contract.py",
  ], 180_000);
  write(output.endsWith("\n") ? output : `${output}\n`);
  const receipt = validateReceipt(output);
  write(`LiteLLM offline contract passed: ${digest}\n`);
  return { digest, receipt };
};

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { runImageSmoke(); }
  catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
