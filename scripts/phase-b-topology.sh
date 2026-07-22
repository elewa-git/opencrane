#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKLOAD_REGISTRY="${PHASE_B_WORKLOAD_REGISTRY:-$ROOT/docs/agents/workload-ownership.json}"
APP_SOURCE_REGISTRY="${PHASE_B_APP_SOURCE_REGISTRY:-$ROOT/docs/agents/app-source-allowlist.json}"

node --input-type=module - "$ROOT" "$WORKLOAD_REGISTRY" "$APP_SOURCE_REGISTRY" <<'NODE'
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const [, , root, workloadRegistryPath, appSourceRegistryPath] = process.argv;
const errors = [];
const info = [];
const appSourceExtensions = new Set([
  ".ts", ".tsx", ".mts", ".cts",
  ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".kt", ".vue", ".svelte",
]);
const runtimeSourceExtensions = new Set([...appSourceExtensions, ".sh", ".yaml", ".yml"]);
const typedSourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);
const ignoredWalkDirectories = new Set(["node_modules", "dist", "coverage", ".nx", ".cache"]);
const workloadKinds = new Set(["Pod", "Deployment", "StatefulSet", "DaemonSet", "CronJob", "Job"]);
const workloadClassifications = new Set(["delete", "survivor"]);
const appSourceClassifications = new Set([
  "app-config",
  "browser-composition",
  "browser-config",
  "browser-entry-guard",
  "browser-entry-view",
  "browser-entrypoint",
  "browser-route-composition",
  "build-entrypoint",
  "composition-test",
  "delete",
  "hosting-composition",
  "prisma-composition",
  "process-entrypoint",
  "process-instrumentation",
  "process-logging",
  "route-composition",
  "test-config",
]);
const workloadKindPattern = /^\s*kind:\s*(Pod|Deployment|StatefulSet|DaemonSet|CronJob|Job)\s*$/m;
const archiveWorkloadKindPattern = /^kind:\s*(Pod|Deployment|StatefulSet|DaemonSet|CronJob|Job|{{[^\n]+}})\s*$/m;
const renderedWorkloadKindPattern = /^kind:\s*(Pod|Deployment|StatefulSet|DaemonSet|CronJob|Job)\s*$/m;
const runtimeWorkloadLinePattern = /^(?:\s*kind:\s*["']?(?:Pod|Deployment|StatefulSet|DaemonSet|CronJob|Job|Cluster)["']?,?\s*|.*\bkubectl\s+(?:run|create\s+(?:job|cronjob|deployment))\b.*|.*\bupgrade\s+--install\b.*|.*\.createNamespaced(?:Pod|Job|Deployment|StatefulSet|DaemonSet)\b.*)$/;

function fail(message)
{
  errors.push(message);
}

function readJson(path)
{
  try
  {
    return JSON.parse(readFileSync(path, "utf8"));
  }
  catch (err)
  {
    throw new Error(`Cannot parse ${relative(root, path)}: ${err.message}`);
  }
}

function workspacePath(path)
{
  const absolute = resolve(root, path);
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`))
  {
    throw new Error(`Registry path escapes the workspace: ${path}`);
  }
  return absolute;
}

function walk(path, visit)
{
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isDirectory() && ignoredWalkDirectories.has(basename(path))) return;
  visit(path, stat);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return;
  for (const entry of readdirSync(path)) walk(join(path, entry), visit);
}

function projectTags(projectFile)
{
  const json = readJson(projectFile);
  return json.tags ?? json.nx?.tags ?? [];
}

function validateExactOwner(owner, context)
{
  if (typeof owner !== "string" || owner.trim() === "")
  {
    fail(`${context}: owner must be one non-empty exact value`);
    return;
  }
  if (/[?*\[\]]/.test(owner))
  {
    fail(`${context}: wildcard owners are forbidden`);
  }
}

function isRegisteredAppOwner(owner)
{
  return /^apps\/(?:_infra\/[^/]+|[^/_][^/]*)$/.test(owner ?? "");
}

const workloadRegistry = readJson(workloadRegistryPath);
const appSourceRegistry = readJson(appSourceRegistryPath);

if (workloadRegistry.version !== 1) fail("workload registry version must be 1");
if (appSourceRegistry.version !== 1) fail("app-source registry version must be 1");

const workloadIds = new Set();
const coveredLocalTemplates = new Set();
const podClassOwners = new Map();
const renderedPodClasses = new Map();
const sourceOwners = new Map();
const compositionOwners = new Map();

function claimIdentity(map, identity, owner, context)
{
  if (!identity) return;
  const previous = map.get(identity);
  if (previous && previous.owner !== owner)
  {
    fail(`${context}: identity '${identity}' conflicts with ${previous.context} (${previous.owner} versus ${owner})`);
    return;
  }
  if (previous)
  {
    fail(`${context}: identity '${identity}' duplicates ${previous.context}`);
    return;
  }
  map.set(identity, { owner, context });
}

for (const workload of workloadRegistry.workloads ?? [])
{
  const context = `workload '${workload.id ?? "<missing>"}'`;
  if (!workload.id || workloadIds.has(workload.id)) fail(`${context}: id is missing or duplicated`);
  workloadIds.add(workload.id);
  if (!workload.podClass || !workload.image) fail(`${context}: podClass and image are required`);
  validateExactOwner(workload.owner, context);
  if (Object.hasOwn(workload, "exception"))
  {
    fail(`${context}: ownership exceptions are forbidden; assign an exact owner and direct classification`);
  }
  if (workload.classification !== undefined)
  {
    if (!workloadClassifications.has(workload.classification))
    {
      fail(`${context}: classification must be 'delete' or 'survivor'`);
    }
    if (typeof workload.reason !== "string" || workload.reason.trim() === "")
    {
      fail(`${context}: classified workload needs an exact reason`);
    }
  }
  const source = workload.source ?? {};
  const sourceIsRepositoryLocal = source.type === "file" || source.type === "archive-member";
  if (workload.localOwner !== sourceIsRepositoryLocal)
  {
    fail(`${context}: localOwner must be derived from the source type, not self-declared`);
  }
  if (!sourceIsRepositoryLocal && workload.classification !== "survivor")
  {
    fail(`${context}: externally sourced workload must be classified 'survivor'`);
  }
  const effectiveOwner = workload.owner ?? "<unowned>";
  claimIdentity(podClassOwners, workload.podClass, effectiveOwner, context);
  if (workload.renderedPodClass)
  {
    claimIdentity(renderedPodClasses, workload.renderedPodClass, effectiveOwner, context);
  }

  if (sourceIsRepositoryLocal && isRegisteredAppOwner(workload.owner))
  {
    const ownerRoot = workspacePath(workload.owner);
    if (!existsSync(ownerRoot) || !lstatSync(ownerRoot).isDirectory())
    {
      fail(`${context}: local owner ${workload.owner} does not exist`);
    }
    const projectFiles = [join(ownerRoot, "project.json"), join(ownerRoot, "package.json")];
    const registered = projectFiles.some(function hasProject(file) {
      if (!existsSync(file)) return false;
      const json = readJson(file);
      return Boolean(json.projectType || json.nx?.name);
    });
    if (!registered) fail(`${context}: ${workload.owner} is not registered as an NX project`);
  }
  else if (sourceIsRepositoryLocal && workload.classification !== "delete")
  {
    fail(`${context}: repository-defined workload needs one apps/<name> or apps/_infra/<name> owner, or a direct delete classification`);
  }

  const sourceIdentity = source.type === "file"
    ? `file:${source.path}:${source.anchor}`
    : source.type === "archive-member"
      ? `archive:${source.archive}:${source.member}:${source.anchor}`
      : source.type === "external"
        ? `external:${source.repository}:${source.contract}`
        : undefined;
  const previousSource = sourceOwners.get(sourceIdentity);
  if (previousSource && previousSource.owner !== effectiveOwner)
  {
    fail(`${context}: source '${sourceIdentity}' conflicts with ${previousSource.context} (${previousSource.owner} versus ${effectiveOwner})`);
  }
  else if (sourceIdentity && !previousSource)
  {
    sourceOwners.set(sourceIdentity, { owner: effectiveOwner, context });
  }
  if (source.type === "file")
  {
    const path = workspacePath(source.path ?? "");
    if (!existsSync(path)) fail(`${context}: source ${source.path} does not exist`);
    else
    {
      if (lstatSync(path).isSymbolicLink()) fail(`${context}: source ${source.path} is a symlink`);
      const contents = readFileSync(path, "utf8");
      if (!source.anchor || !contents.includes(source.anchor))
      {
        fail(`${context}: source anchor is stale in ${source.path}`);
      }
      if (source.coversLocalTemplate) coveredLocalTemplates.add(source.path);
    }
  }
  else if (source.type === "archive-member")
  {
    const archive = workspacePath(source.archive ?? "");
    if (!existsSync(archive)) fail(`${context}: archive ${source.archive} does not exist`);
    else
    {
      try
      {
        const members = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).split("\n");
        if (!members.includes(source.member)) fail(`${context}: archive member ${source.member} is missing`);
        else
        {
          const contents = execFileSync("tar", ["-xOzf", archive, source.member], { encoding: "utf8" });
          if (!source.anchor || !contents.includes(source.anchor))
          {
            fail(`${context}: archive-member anchor is stale in ${source.member}`);
          }
        }
      }
      catch (err)
      {
        fail(`${context}: cannot inspect ${source.archive}: ${err.message}`);
      }
    }
  }
  else if (source.type === "external")
  {
    const evidence = workspacePath(source.localEvidence ?? "");
    if (!source.repository || !source.contract) fail(`${context}: external source needs repository and contract`);
    if (!existsSync(evidence)) fail(`${context}: local evidence ${source.localEvidence} does not exist`);
    else if (!source.anchor || !readFileSync(evidence, "utf8").toLowerCase().includes(source.anchor.toLowerCase()))
    {
      fail(`${context}: external-source evidence anchor is stale`);
    }
  }
  else
  {
    fail(`${context}: unsupported source type '${source.type}'`);
  }

  if (workload.composition)
  {
    claimIdentity(
      compositionOwners,
      `${workload.composition.path}:${workload.composition.anchor}`,
      effectiveOwner,
      context,
    );
    const compositionPath = workspacePath(workload.composition.path ?? "");
    if (!existsSync(compositionPath))
    {
      fail(`${context}: composition source ${workload.composition.path} does not exist`);
    }
    else if (!workload.composition.anchor || !readFileSync(compositionPath, "utf8").includes(workload.composition.anchor))
    {
      fail(`${context}: composition anchor is stale in ${workload.composition.path}`);
    }
  }
}

const requiredWorkloadIds = new Set(workloadRegistry.requiredWorkloadIds ?? []);
if (requiredWorkloadIds.size !== (workloadRegistry.requiredWorkloadIds ?? []).length)
{
  fail("requiredWorkloadIds contains a duplicate id");
}
for (const id of requiredWorkloadIds)
{
  if (!workloadIds.has(id)) fail(`required workload registration is missing: ${id}`);
}
for (const id of workloadIds)
{
  if (!requiredWorkloadIds.has(id)) fail(`workload '${id}' is not pinned in requiredWorkloadIds`);
}

for (const forbidden of workloadRegistry.forbiddenPaths ?? [])
{
  if (existsSync(workspacePath(forbidden))) fail(`retired embedded workload path returned: ${forbidden}`);
}

const renderedAcrossProfiles = new Set();
for (const profile of workloadRegistry.renderProfiles ?? [])
{
  const context = `render profile '${profile.id ?? "<missing>"}'`;
  if (!profile.id) fail(`${context}: id is required`);
  const args = [
    "template",
    "opencrane",
    workspacePath("apps/_infra/deploy-k8s"),
    "--namespace",
    "opencrane-system",
  ];
  for (const value of profile.setValues ?? []) args.push("--set", value);
  let manifest = "";
  try
  {
    manifest = execFileSync("helm", args, { cwd: root, encoding: "utf8" });
  }
  catch (err)
  {
    fail(`${context}: Helm render failed: ${err.message}`);
    continue;
  }

  const actual = new Set();
  for (const document of manifest.split(/^---\s*$/m))
  {
    const kind = renderedWorkloadKindPattern.exec(document)?.[1];
    if (!kind) continue;
    const metadataStart = document.search(/^metadata:\s*$/m);
    const name = metadataStart === -1
      ? undefined
      : /^  name:\s*([^\s]+)\s*$/m.exec(document.slice(metadataStart))?.[1];
    if (!name)
    {
      fail(`${context}: rendered ${kind} has no exact metadata.name`);
      continue;
    }
    const podClass = `${kind}/${name}`;
    if (actual.has(podClass)) fail(`${context}: duplicate rendered pod class ${podClass}`);
    actual.add(podClass);
    renderedAcrossProfiles.add(podClass);
    if (!renderedPodClasses.has(podClass))
    {
      fail(`${context}: unregistered rendered pod class ${podClass}`);
    }
  }

  const expected = new Set(profile.expectedRenderedPodClasses ?? []);
  if (expected.size !== (profile.expectedRenderedPodClasses ?? []).length)
  {
    fail(`${context}: expectedRenderedPodClasses contains a duplicate`);
  }
  for (const podClass of expected)
  {
    if (!actual.has(podClass)) fail(`${context}: expected pod class did not render: ${podClass}`);
    if (!renderedPodClasses.has(podClass)) fail(`${context}: expected pod class has no workload owner: ${podClass}`);
  }
  for (const podClass of actual)
  {
    if (!expected.has(podClass)) fail(`${context}: render output is not pinned: ${podClass}`);
  }
}
for (const podClass of renderedPodClasses.keys())
{
  if (!renderedAcrossProfiles.has(podClass)) fail(`registered rendered pod class is absent from every profile: ${podClass}`);
}
info.push(`${(workloadRegistry.renderProfiles ?? []).length} Helm profiles match their exact pod-class inventories`);

function renderSilo(args, context)
{
  try
  {
    return execFileSync(
      "helm",
      ["template", "opencrane", workspacePath("apps/_infra/deploy-k8s"), "--namespace", "opencrane-system", ...args],
      { cwd: root, encoding: "utf8" },
    );
  }
  catch (err)
  {
    fail(`${context}: Helm render failed: ${err.message}`);
    return "";
  }
}

const namespaceManagerName = "opencrane-opencrane-server-ns-manage-opencrane-system";
const defaultManifest = renderSilo([], "default namespace-authority contract");
if (!defaultManifest.includes(namespaceManagerName))
{
  fail("default namespace-authority contract: local control plane must grant namespace management");
}

const standaloneManifest = renderSilo(
  ["--values", workspacePath("apps/_infra/deploy-k8s/values/standalone.yaml")],
  "standalone namespace-authority contract",
);
const namespaceManagerDocuments = standaloneManifest.split(/^---\s*$/m).filter(function isNamespaceManager(document) {
  return document.includes(`name: ${namespaceManagerName}`);
});
const namespaceManagerRole = namespaceManagerDocuments.find(function isClusterRole(document) {
  return /^kind: ClusterRole\s*$/m.test(document);
});
const namespaceManagerBinding = namespaceManagerDocuments.find(function isClusterRoleBinding(document) {
  return /^kind: ClusterRoleBinding\s*$/m.test(document);
});
if (!namespaceManagerRole)
{
  fail("standalone namespace-authority contract: app-owned server ClusterRole did not render");
}
else
{
  if (!/^\s*resources: \["namespaces"\]\s*$/m.test(namespaceManagerRole))
  {
    fail("standalone namespace-authority contract: ClusterRole does not target namespaces");
  }
  if (!/^\s*verbs: \["get", "list", "watch", "create", "patch"\]\s*$/m.test(namespaceManagerRole))
  {
    fail("standalone namespace-authority contract: ClusterRole verbs drifted from least privilege");
  }
}
if (!namespaceManagerBinding)
{
  fail("standalone namespace-authority contract: app-owned server ClusterRoleBinding did not render");
}
else if (!namespaceManagerBinding.includes("name: opencrane-opencrane-server\n    namespace: opencrane-system"))
{
  fail("standalone namespace-authority contract: ClusterRoleBinding does not bind the server service account");
}
info.push("standalone namespace management is rendered app-locally and absent by default");

const runtimeConstructs = new Map();
for (const entry of workloadRegistry.runtimeConstructs ?? [])
{
  const context = `runtime construct '${entry.path ?? "<missing>"}:${entry.anchor ?? "<missing>"}'`;
  const identity = `${entry.path}\u0000${entry.anchor}`;
  if (!entry.path || !entry.anchor || runtimeConstructs.has(identity))
  {
    fail(`${context}: path and anchor must be unique exact values`);
    continue;
  }
  const sourcePath = workspacePath(entry.path);
  if (!existsSync(sourcePath)) fail(`${context}: source does not exist`);
  else
  {
    const contents = readFileSync(sourcePath, "utf8");
    const occurrenceCount = contents.split(entry.anchor).length - 1;
    if (occurrenceCount !== 1)
    {
      fail(`${context}: anchor must occur exactly once, found ${occurrenceCount}`);
    }
  }
  if (!Array.isArray(entry.workloadIds) || entry.workloadIds.length === 0)
  {
    fail(`${context}: workloadIds must map the construct to at least one exact owner`);
  }
  else if (new Set(entry.workloadIds).size !== entry.workloadIds.length)
  {
    fail(`${context}: workloadIds contains a duplicate`);
  }
  for (const id of entry.workloadIds ?? [])
  {
    if (!workloadIds.has(id)) fail(`${context}: unknown workload id ${id}`);
  }
  runtimeConstructs.set(identity, { ...entry, hit: false });
}

const nonProducingRuntimeMatches = new Map();
for (const entry of workloadRegistry.nonProducingRuntimeMatches ?? [])
{
  const context = `non-producing runtime match '${entry.path ?? "<missing>"}:${entry.anchor ?? "<missing>"}'`;
  const identity = `${entry.path}\u0000${entry.anchor}`;
  if (!entry.path || !entry.anchor || !entry.reason || nonProducingRuntimeMatches.has(identity))
  {
    fail(`${context}: path, anchor, reason, and uniqueness are required`);
    continue;
  }
  const sourcePath = workspacePath(entry.path);
  if (!existsSync(sourcePath)) fail(`${context}: source does not exist`);
  else
  {
    const contents = readFileSync(sourcePath, "utf8");
    const occurrenceCount = contents.split(entry.anchor).length - 1;
    if (occurrenceCount !== 1)
    {
      fail(`${context}: anchor must occur exactly once, found ${occurrenceCount}`);
    }
  }
  nonProducingRuntimeMatches.set(identity, { ...entry, hit: false });
}

function classifyRuntimeConstruct(rel, candidate, display)
{
  const producer = [...runtimeConstructs.values()].find(function matches(entry) {
    return entry.path === rel && candidate.includes(entry.anchor);
  });
  if (producer)
  {
    producer.hit = true;
    return;
  }
  const nonProducer = [...nonProducingRuntimeMatches.values()].find(function matches(entry) {
    return entry.path === rel && candidate.includes(entry.anchor);
  });
  if (nonProducer)
  {
    nonProducer.hit = true;
    return;
  }
  fail(`unregistered runtime or installer workload construct: ${rel}: ${display}`);
}

function objectProperty(object, name, sourceFile)
{
  return object.properties.find(function findProperty(property) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return false;
    if (ts.isComputedPropertyName(property.name))
    {
      return ts.isStringLiteralLike(property.name.expression) && property.name.expression.text === name;
    }
    return property.name.getText(sourceFile).replace(/^["']|["']$/g, "") === name;
  });
}

for (const scanRoot of ["apps", "libs", "scripts"])
{
  walk(workspacePath(scanRoot), function inspectRuntimeConstructor(path, stat) {
    if (!stat.isFile() || stat.isSymbolicLink()) return;
    const rel = relative(root, path).split(sep).join("/");
    if (rel === "scripts/phase-b-topology.sh" || rel === "scripts/phase-b-topology-negative-tests.sh") return;
    if (rel.includes("/__tests__/") || rel.includes("/tests/") || /\.test\.[^.]+$/.test(rel)) return;
    if (rel.startsWith("apps/") && rel.includes("/templates/") && /\.ya?ml$/.test(rel)) return;
    if (!runtimeSourceExtensions.has(extname(rel))) return;
    const contents = readFileSync(path, "utf8");
    const importsKubernetesClient = contents.includes("@kubernetes/client-node");
    for (const rawLine of contents.split("\n"))
    {
      const line = rawLine.trim();
      if (line.startsWith("#") || line.startsWith("//")) continue;
      const dynamicManifestKind = /^(?:kind:)\s*(?:[$][{]|{{)/.test(line);
      const genericKubernetesCreate = rel === "libs/server/_infra/api/src/k8s-apply.ts" && /\.create\s*\(/.test(line);
      if (!runtimeWorkloadLinePattern.test(rawLine) && !dynamicManifestKind && !genericKubernetesCreate) continue;
      classifyRuntimeConstruct(rel, line, line);
    }

    if (typedSourceExtensions.has(extname(rel)))
    {
      const sourceFile = ts.createSourceFile(rel, contents, ts.ScriptTarget.Latest, true);
      function inspectNode(node)
      {
        if (ts.isObjectLiteralExpression(node))
        {
          const apiVersion = objectProperty(node, "apiVersion", sourceFile);
          const kind = objectProperty(node, "kind", sourceFile);
          if (apiVersion && kind)
          {
            const kindText = kind.getText(sourceFile);
            const initializer = ts.isPropertyAssignment(kind) ? kind.initializer : undefined;
            if (initializer && ts.isStringLiteralLike(initializer))
            {
              if (workloadKinds.has(initializer.text)) classifyRuntimeConstruct(rel, kindText, kindText);
            }
            else
            {
              classifyRuntimeConstruct(rel, kindText, `computed Kubernetes ${kindText}`);
            }
          }
        }
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression))
        {
          const method = node.expression.name.text;
          const typedWorkloadCreate = /^createNamespaced(?:Pod|Job|Deployment|StatefulSet|DaemonSet)$/.test(method);
          const receiver = node.expression.expression.getText(sourceFile);
          const genericKubernetesCreate = importsKubernetesClient
            && method === "create"
            && /(?:^|\.)(?:client|objectApi|k8sApi|appsApi|batchApi|coreApi)$/.test(receiver);
          if (typedWorkloadCreate || genericKubernetesCreate)
          {
            const callText = node.getText(sourceFile);
            classifyRuntimeConstruct(rel, callText, callText.replace(/\s+/g, " "));
          }
        }
        ts.forEachChild(node, inspectNode);
      }
      inspectNode(sourceFile);
    }
  });
}
for (const entry of runtimeConstructs.values())
{
  if (!entry.hit) fail(`runtime construct was not discovered by the guard: ${entry.path}: ${entry.anchor}`);
}
for (const entry of nonProducingRuntimeMatches.values())
{
  if (!entry.hit) fail(`non-producing runtime match was not discovered by the guard: ${entry.path}: ${entry.anchor}`);
}
info.push(`${runtimeConstructs.size} runtime and installer workload constructs are exactly registered`);

const archiveInventory = workloadRegistry.archiveWorkloadInventory ?? {};
const archivePath = workspacePath(archiveInventory.archive ?? "");
if (!existsSync(archivePath))
{
  fail(`archive workload inventory is missing ${archiveInventory.archive}`);
}
else
{
  const expectedMembers = new Map();
  for (const entry of archiveInventory.members ?? [])
  {
    const context = `archive workload member '${entry.member ?? "<missing>"}'`;
    if (!entry.member || expectedMembers.has(entry.member))
    {
      fail(`${context}: member is missing or duplicated`);
      continue;
    }
    if (entry.status === "rendered")
    {
      if (!workloadIds.has(entry.workloadId)) fail(`${context}: rendered member needs a registered workloadId`);
    }
    else if (entry.status === "disabled-by-opencrane-values")
    {
      if (!entry.reason) fail(`${context}: disabled member needs an exact reason`);
    }
    else
    {
      fail(`${context}: unsupported status '${entry.status}'`);
    }
    expectedMembers.set(entry.member, entry);
  }

  try
  {
    const members = execFileSync("tar", ["-tzf", archivePath], { encoding: "utf8" }).trim().split("\n");
    const actualMembers = new Set();
    for (const member of members)
    {
      if (!/templates\/.*\.ya?ml$/.test(member)) continue;
      const contents = execFileSync("tar", ["-xOzf", archivePath, member], { encoding: "utf8" });
      if (archiveWorkloadKindPattern.test(contents)) actualMembers.add(member);
    }
    for (const member of actualMembers)
    {
      if (!expectedMembers.has(member)) fail(`unregistered upstream archive workload template: ${member}`);
    }
    for (const member of expectedMembers.keys())
    {
      if (!actualMembers.has(member)) fail(`stale upstream archive workload registration: ${member}`);
    }
    info.push(`${actualMembers.size} upstream archive workload templates are exactly inventoried`);
  }
  catch (err)
  {
    fail(`cannot inspect archive workload inventory: ${err.message}`);
  }
}

const discoveredWorkloadTemplates = new Set();
const nonWorkloadDynamicKinds = new Map();
for (const entry of workloadRegistry.nonWorkloadDynamicKinds ?? [])
{
  const context = `non-workload dynamic kind '${entry.path ?? "<missing>"}'`;
  if (!entry.path || !entry.anchor || !entry.reason || nonWorkloadDynamicKinds.has(entry.path))
  {
    fail(`${context}: path, anchor, reason, and unique path are required`);
    continue;
  }
  if (!Array.isArray(entry.resolvedKinds) || entry.resolvedKinds.length === 0)
  {
    fail(`${context}: resolvedKinds must be a non-empty exact list`);
  }
  else if (entry.resolvedKinds.some(function isWorkload(kind) { return workloadKinds.has(kind); }))
  {
    fail(`${context}: a pod-producing kind cannot be exempted`);
  }
  const path = workspacePath(entry.path);
  if (!existsSync(path)) fail(`${context}: source does not exist`);
  else if (!readFileSync(path, "utf8").includes(entry.anchor)) fail(`${context}: anchor is stale`);
  nonWorkloadDynamicKinds.set(entry.path, { ...entry, hit: false });
}
walk(workspacePath("apps"), function inspectWorkloadTemplate(path, stat) {
  if (!stat.isFile()) return;
  const rel = relative(root, path).split(sep).join("/");
  if (!rel.includes("/templates/")) return;
  if (!/\.(?:ya?ml|tpl)$/.test(rel)) return;
  const contents = readFileSync(path, "utf8");
  if (workloadKindPattern.test(contents)) discoveredWorkloadTemplates.add(rel);
  for (const match of contents.matchAll(/^kind:\s*({{[^\n]+}})\s*$/gm))
  {
    if (coveredLocalTemplates.has(rel))
    {
      discoveredWorkloadTemplates.add(rel);
      continue;
    }
    const exemption = nonWorkloadDynamicKinds.get(rel);
    if (exemption && exemption.anchor.includes(match[0]))
    {
      exemption.hit = true;
      continue;
    }
    fail(`unregistered computed kind template: ${rel}: ${match[0]}`);
  }
});
for (const entry of nonWorkloadDynamicKinds.values())
{
  if (!entry.hit) fail(`non-workload dynamic-kind exemption was not discovered: ${entry.path}`);
}
for (const path of discoveredWorkloadTemplates)
{
  if (!coveredLocalTemplates.has(path)) fail(`unregistered local workload template: ${path}`);
}
for (const path of coveredLocalTemplates)
{
  if (!discoveredWorkloadTemplates.has(path)) fail(`stale workload-template registration: ${path}`);
}
info.push(`${discoveredWorkloadTemplates.size} local workload templates are exactly registered`);

const allowedSourceFiles = new Map();
for (const entry of appSourceRegistry.allowedFiles ?? [])
{
  const context = `app source '${entry.path ?? "<missing>"}'`;
  if (!entry.path || allowedSourceFiles.has(entry.path)) fail(`${context}: path is missing or duplicated`);
  allowedSourceFiles.set(entry.path, entry);
  if (!/^apps\/(?:_infra\/[^/]+|[^/_][^/]*)\//.test(entry.path ?? ""))
  {
    fail(`${context}: path must be below one apps/<name> or apps/_infra/<name> root`);
  }
  if (typeof entry.owner !== "string" || !entry.path.startsWith(`${entry.owner}/`))
  {
    fail(`${context}: owner does not match path`);
  }
  if (!appSourceClassifications.has(entry.classification))
  {
    fail(`${context}: classification is not an exact direct-refactor class`);
  }
  if (Object.hasOwn(entry, "exception"))
  {
    fail(`${context}: ownership exceptions are forbidden; classify the file directly`);
  }
  const path = workspacePath(entry.path ?? "");
  if (!existsSync(path)) fail(`${context}: allowlist entry is stale`);
  else if (lstatSync(path).isSymbolicLink()) fail(`${context}: symlinks are forbidden`);
}

const discoveredAppSource = new Set();
walk(workspacePath("apps"), function inspectAppSource(path, stat) {
  const rel = relative(root, path).split(sep).join("/");
  if (stat.isSymbolicLink()) fail(`symlink under apps is forbidden: ${rel}`);
  if (!stat.isFile()) return;
  if (appSourceExtensions.has(extname(rel))) discoveredAppSource.add(rel);
});
for (const path of discoveredAppSource)
{
  if (!allowedSourceFiles.has(path)) fail(`unregistered implementation source under app root: ${path}`);
}
for (const path of allowedSourceFiles.keys())
{
  if (!discoveredAppSource.has(path)) fail(`stale app-source allowlist entry: ${path}`);
}
info.push(`${discoveredAppSource.size} app implementation-source files are exactly allowlisted`);

for (const forbidden of appSourceRegistry.forbiddenPaths ?? [])
{
  const path = workspacePath(forbidden);
  if (!existsSync(path)) continue;
  const stat = lstatSync(path);
  if (!stat.isDirectory() || readdirSync(path).length > 0)
  {
    fail(`retired app logic path returned: ${forbidden}`);
  }
}

for (const projectPath of appSourceRegistry.requiredTaggedProjects ?? [])
{
  const path = workspacePath(projectPath);
  if (!existsSync(path))
  {
    fail(`required tagged project is missing: ${projectPath}`);
    continue;
  }
  const tags = projectTags(path);
  for (const dimension of ["type:", "layer:", "scope:"])
  {
    const matching = tags.filter(function matches(tag) { return tag.startsWith(dimension); });
    if (matching.length !== 1)
    {
      fail(`${projectPath}: expected exactly one ${dimension.slice(0, -1)} tag, found ${matching.length}`);
    }
  }
}
info.push(`${(appSourceRegistry.requiredTaggedProjects ?? []).length} Phase B projects have three-dimensional tags`);

const symlinkRoots = new Set([workspacePath("apps")]);
for (const projectPath of appSourceRegistry.requiredTaggedProjects ?? [])
{
  symlinkRoots.add(dirname(workspacePath(projectPath)));
}
for (const symlinkRoot of symlinkRoots)
{
  walk(symlinkRoot, function inspectSymlink(path, stat) {
    if (stat.isSymbolicLink()) fail(`symlink/forwarder path is forbidden: ${relative(root, path)}`);
  });
}

if (errors.length > 0)
{
  process.stderr.write("Phase B topology guard failed:\n");
  for (const error of errors) process.stderr.write(`  - ${error}\n`);
  process.exit(1);
}

process.stdout.write("Phase B topology guard passed.\n");
for (const line of info) process.stdout.write(`  - ${line}\n`);
process.stdout.write(`  - ${workloadIds.size} static, runtime-generated, upstream, and deferred pod classes are registered\n`);
NODE
