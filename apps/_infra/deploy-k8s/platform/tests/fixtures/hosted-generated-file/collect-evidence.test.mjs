import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { collectHostedEvidence } from "./collect-evidence.mjs";

test("retains only the named public evidence and removes archive paths", async t =>
{
  const root = await mkdtemp(join(tmpdir(), "hosted-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = join(root, "run");
  await mkdir(join(run, "evidence"), { recursive: true });
  for (const name of ["hosted-generated-file.json", "protocol.json", "checkpoint.json", "private-key.json"])
    await writeFile(join(run, "evidence", name), JSON.stringify({ name }));
  await writeFile(join(run, "hosted-services.env"), "PRIVATE_FIXTURE_VALUE=not-for-evidence");
  const coordinates = { archiveDigest: `sha256:${"a".repeat(64)}`, archiveByteLength: 123, imageDigest: `sha256:${"b".repeat(64)}` };
  await writeFile(join(run, "oci-archive-evidence.json"), JSON.stringify({ ...coordinates, archivePath: "/temporary/archive.zip", expectedCsvPath: "/temporary/result.csv" }));
  await collectHostedEvidence(run, join(root, "collected"));
  const result = join(root, "collected", "run");
  assert.deepEqual((await readdir(result)).sort(), ["hosted-generated-file.json", "oci-image.json", "protocol.json"]);
  assert.deepEqual(JSON.parse(await readFile(join(result, "oci-image.json"), "utf8")), coordinates);
});

test("early failure may omit evidence but cannot replace retained evidence", async t =>
{
  const root = await mkdtemp(join(tmpdir(), "hosted-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = join(root, "run");
  await collectHostedEvidence(run, join(root, "collected"));
  await mkdir(join(run, "evidence"), { recursive: true });
  await writeFile(join(run, "evidence", "protocol.json"), "{}");
  await collectHostedEvidence(run, join(root, "collected"));
  await assert.rejects(collectHostedEvidence(run, join(root, "collected")), { code: "EEXIST" });
});

test("rejects links even when they use an allowed evidence filename", async t =>
{
  const root = await mkdtemp(join(tmpdir(), "hosted-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = join(root, "run");
  await mkdir(join(run, "evidence"), { recursive: true });
  await writeFile(join(root, "private-key"), "not-for-evidence");
  await symlink(join(root, "private-key"), join(run, "evidence", "protocol.json"));
  await assert.rejects(collectHostedEvidence(run, join(root, "collected")), /regular file/u);
});
