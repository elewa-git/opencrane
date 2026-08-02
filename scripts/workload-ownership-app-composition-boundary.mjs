import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const [, , root, workloadRegistryPath, appSourceRegistryPath] = process.argv;
const errors = [];
const info = [];
const appSourceExtensions = new Set([
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".kt", ".vue", ".svelte",
]);
const runtimeSourceExtensions = new Set([...appSourceExtensions, ".sh", ".yaml", ".yml"]);
const typedSourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);
const ignoredDirectories = new Set(["node_modules", "dist", "coverage", ".nx", ".cache"]);
const workloadKinds = new Set(["Pod", "Deployment", "StatefulSet", "DaemonSet", "CronJob", "Job"]);
const appSourceClassifications = new Set([
  "app-config", "browser-composition", "browser-config", "browser-entry-guard",
  "browser-entry-view", "browser-entrypoint", "browser-route-composition",
  "build-entrypoint", "composition-test", "hosting-composition", "prisma-composition",
  "process-composition", "process-entrypoint", "process-instrumentation",
  "process-logging", "route-composition", "test-config", "artifact-broker-composition",
]);

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
  catch (error)
  {
    throw new Error(`Cannot parse ${relative(root, path)}: ${error.message}`);
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
  if (stat.isDirectory() && ignoredDirectories.has(basename(path))) return;
  visit(path, stat);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return;
  for (const entry of readdirSync(path)) walk(join(path, entry), visit);
}

function normalizedRelative(path)
{
  return relative(root, path).split(sep).join("/");
}

function projectTags(projectFile)
{
  const project = readJson(projectFile);
  return project.tags ?? project.nx?.tags ?? [];
}

function exactAppOwner(owner, context)
{
  if (!/^apps\/(?:_infra\/[^/]+|[^/_][^/]*)$/.test(owner ?? ""))
  {
    fail(`${context}: owner must be one exact apps/<name> or apps/_infra/<name> root`);
    return false;
  }
  return true;
}

function claimIdentity(map, identity, owner, context)
{
  const previous = map.get(identity);
  if (previous)
  {
    fail(`${context}: identity '${identity}' duplicates ${previous.context}`);
    return;
  }
  map.set(identity, { owner, context });
}

function sourceContains(path, anchor, context)
{
  if (!existsSync(path))
  {
    fail(`${context}: source ${normalizedRelative(path)} does not exist`);
    return false;
  }
  if (lstatSync(path).isSymbolicLink())
  {
    fail(`${context}: source ${normalizedRelative(path)} is a symlink`);
    return false;
  }
  if (!anchor || !readFileSync(path, "utf8").includes(anchor))
  {
    fail(`${context}: source anchor is stale in ${normalizedRelative(path)}`);
    return false;
  }
  return true;
}

function objectProperty(object, name, sourceFile)
{
  return object.properties.find(function findProperty(property) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return false;
    if (ts.isComputedPropertyName(property.name))
    {
      return ts.isStringLiteralLike(property.name.expression) && property.name.expression.text === name;
    }
    return property.name.getText(sourceFile).replace(/^['"]|['"]$/g, "") === name;
  });
}

const workloadRegistry = readJson(workloadRegistryPath);
const appSourceRegistry = readJson(appSourceRegistryPath);
if (workloadRegistry.version !== 2) fail("workload registry version must be 2");
if (appSourceRegistry.version !== 2) fail("app-source registry version must be 2");

const workloadIds = new Set();
const podClasses = new Map();
const renderedPodClasses = new Map();
const localTemplateSources = new Set();

for (const workload of workloadRegistry.workloads ?? [])
{
  const context = `workload '${workload.id ?? "<missing>"}'`;
  if (!workload.id || workloadIds.has(workload.id)) fail(`${context}: id is missing or duplicated`);
  workloadIds.add(workload.id);
  if (!workload.podClass || !workload.image) fail(`${context}: podClass and image are required`);
  if (!exactAppOwner(workload.owner, context)) continue;
  claimIdentity(podClasses, workload.podClass, workload.owner, context);
  if (workload.renderedPodClass) claimIdentity(renderedPodClasses, workload.renderedPodClass, workload.owner, context);

  const ownerRoot = workspacePath(workload.owner);
  if (!existsSync(ownerRoot) || !lstatSync(ownerRoot).isDirectory())
  {
    fail(`${context}: owner ${workload.owner} does not exist`);
  }
  else
  {
    const projectFiles = [join(ownerRoot, "project.json"), join(ownerRoot, "package.json")];
    const registered = projectFiles.some(function isNxProject(file) {
      if (!existsSync(file)) return false;
      const project = readJson(file);
      return Boolean(project.projectType || project.nx?.name);
    });
    if (!registered) fail(`${context}: owner ${workload.owner} is not an NX project`);
  }

  const source = workload.source ?? {};
  if (source.type !== "file" || !source.path || !source.anchor)
  {
    fail(`${context}: source must be a current repository file with one exact anchor`);
  }
  else
  {
    const sourcePath = workspacePath(source.path);
    sourceContains(sourcePath, source.anchor, context);
    if (source.coversLocalTemplate) localTemplateSources.add(source.path);
  }

  if (workload.renderedPodClass && !workload.composition)
  {
    fail(`${context}: a rendered workload must name its app composition anchor`);
  }
  if (workload.composition)
  {
    const compositionPath = workspacePath(workload.composition.path ?? "");
    sourceContains(compositionPath, workload.composition.anchor, context);
  }
}

const renderedAcrossProfiles = new Set();
for (const profile of workloadRegistry.renderProfiles ?? [])
{
  const context = `render profile '${profile.id ?? "<missing>"}'`;
  if (!profile.id) fail(`${context}: id is required`);
  const args = ["template", "opencrane", workspacePath("apps/_infra/deploy-k8s"), "--namespace", "opencrane-system"];
  for (const value of profile.setValues ?? []) args.push("--set", value);
  let manifest = "";
  try
  {
    manifest = execFileSync("helm", args, { cwd: root, encoding: "utf8" });
  }
  catch (error)
  {
    fail(`${context}: Helm render failed: ${error.message}`);
    continue;
  }

  const actual = new Set();
  for (const document of manifest.split(/^---\s*$/m))
  {
    const kind = /^kind:\s*(Pod|Deployment|StatefulSet|DaemonSet|CronJob|Job)\s*$/m.exec(document)?.[1];
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
    if (!renderedPodClasses.has(podClass)) fail(`${context}: unregistered rendered pod class ${podClass}`);
  }

  const expected = new Set(profile.expectedRenderedPodClasses ?? []);
  if (expected.size !== (profile.expectedRenderedPodClasses ?? []).length) fail(`${context}: expectedRenderedPodClasses contains a duplicate`);
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

const dynamicWorkloads = new Map();
for (const entry of workloadRegistry.dynamicWorkloads ?? [])
{
  const context = `dynamic workload '${entry.path ?? "<missing>"}:${entry.anchor ?? "<missing>"}'`;
  const identity = `${entry.path}\u0000${entry.anchor}`;
  if (!entry.path || !entry.anchor || dynamicWorkloads.has(identity))
  {
    fail(`${context}: path and anchor must be unique exact values`);
    continue;
  }
  sourceContains(workspacePath(entry.path), entry.anchor, context);
  if (!Array.isArray(entry.workloadIds) || entry.workloadIds.length === 0 || new Set(entry.workloadIds).size !== entry.workloadIds.length)
  {
    fail(`${context}: workloadIds must be a non-empty, duplicate-free list`);
  }
  for (const id of entry.workloadIds ?? []) if (!workloadIds.has(id)) fail(`${context}: unknown workload id ${id}`);
  dynamicWorkloads.set(identity, { ...entry, hit: false });
}

function classifyDynamicWorkload(rel, candidate, display)
{
  const entry = [...dynamicWorkloads.values()].find(function matches(configured) {
    return configured.path === rel && candidate.includes(configured.anchor);
  });
  if (entry)
  {
    entry.hit = true;
    return;
  }
  fail(`unregistered runtime workload construct: ${rel}: ${display}`);
}

for (const scanRoot of ["apps", "libs", "scripts"])
{
  walk(workspacePath(scanRoot), function inspectRuntimeWorkloads(path, stat) {
    if (!stat.isFile() || stat.isSymbolicLink()) return;
    const rel = normalizedRelative(path);
    if (rel.startsWith("scripts/workload-ownership-app-composition-boundary")) return;
    if (rel.includes("/__tests__/") || rel.includes("/tests/") || /\.test\.[^.]+$/.test(rel)) return;
    if (rel.startsWith("apps/") && rel.includes("/templates/") && /\.ya?ml$/.test(rel)) return;
    if (!runtimeSourceExtensions.has(extname(rel))) return;
    const contents = readFileSync(path, "utf8");
    if (!typedSourceExtensions.has(extname(rel)))
    {
      for (const rawLine of contents.split("\n"))
      {
        if (/^\s*(?:#|\/\/)/.test(rawLine)) continue;
        if (/\bkubectl\s+(?:run|create\s+(?:job|cronjob|deployment))\b/.test(rawLine))
        {
          classifyDynamicWorkload(rel, rawLine.trim(), rawLine.trim());
        }
      }
      return;
    }

    const sourceFile = ts.createSourceFile(rel, contents, ts.ScriptTarget.Latest, true);
    function inspectNode(node)
    {
      if (ts.isObjectLiteralExpression(node))
      {
        const apiVersion = objectProperty(node, "apiVersion", sourceFile);
        const kind = objectProperty(node, "kind", sourceFile);
        const spec = objectProperty(node, "spec", sourceFile);
        const initializer = kind && ts.isPropertyAssignment(kind) ? kind.initializer : undefined;
        if (apiVersion && spec && initializer && ts.isStringLiteralLike(initializer) && workloadKinds.has(initializer.text))
        {
          classifyDynamicWorkload(rel, kind.getText(sourceFile), kind.getText(sourceFile));
        }
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression))
      {
        const method = node.expression.name.text;
        if (/^createNamespaced(?:Pod|Job|Deployment|StatefulSet|DaemonSet)$/.test(method))
        {
          const call = node.getText(sourceFile);
          classifyDynamicWorkload(rel, call, call.replace(/\s+/g, " "));
        }
      }
      ts.forEachChild(node, inspectNode);
    }
    inspectNode(sourceFile);
  });
}
for (const entry of dynamicWorkloads.values())
{
  if (!entry.hit) fail(`dynamic workload is not discovered by the guard: ${entry.path}: ${entry.anchor}`);
}
info.push(`${dynamicWorkloads.size} runtime-created workload constructs are exactly registered`);

const discoveredTemplates = new Set();
walk(workspacePath("apps"), function inspectTemplates(path, stat) {
  if (!stat.isFile()) return;
  const rel = normalizedRelative(path);
  if (!rel.includes("/templates/") || !/\.(?:ya?ml|tpl)$/.test(rel)) return;
  if (/^\s*kind:\s*(Pod|Deployment|StatefulSet|DaemonSet|CronJob|Job)\s*$/m.test(readFileSync(path, "utf8"))) discoveredTemplates.add(rel);
});
for (const path of discoveredTemplates)
{
  if (!localTemplateSources.has(path)) fail(`unregistered local workload template: ${path}`);
}
for (const path of localTemplateSources)
{
  if (!discoveredTemplates.has(path)) fail(`stale workload-template registration: ${path}`);
}
info.push(`${discoveredTemplates.size} local workload templates are exactly registered`);

const allowedSourceFiles = new Map();
for (const entry of appSourceRegistry.allowedFiles ?? [])
{
  const context = `app source '${entry.path ?? "<missing>"}'`;
  if (!entry.path || allowedSourceFiles.has(entry.path)) fail(`${context}: path is missing or duplicated`);
  allowedSourceFiles.set(entry.path, entry);
  if (!/^apps\/(?:_infra\/[^/]+|[^/_][^/]*)\//.test(entry.path ?? "")) fail(`${context}: path must be below one app root`);
  if (!entry.path.startsWith(`${entry.owner}/`) || !exactAppOwner(entry.owner, context)) fail(`${context}: owner does not match path`);
  if (!appSourceClassifications.has(entry.classification)) fail(`${context}: classification is not an app-composition class`);
  const path = workspacePath(entry.path ?? "");
  if (!existsSync(path)) fail(`${context}: allowlist entry is stale`);
  else if (lstatSync(path).isSymbolicLink()) fail(`${context}: symlinks are forbidden`);
}

const discoveredAppSource = new Set();
walk(workspacePath("apps"), function inspectAppSource(path, stat) {
  const rel = normalizedRelative(path);
  if (stat.isSymbolicLink()) fail(`symlink under apps is forbidden: ${rel}`);
  if (rel.includes("/__tests__/") || rel.includes("/tests/") || /\.test\.[^.]+$/.test(rel)) return;
  if (stat.isFile() && appSourceExtensions.has(extname(rel))) discoveredAppSource.add(rel);
});
for (const path of discoveredAppSource) if (!allowedSourceFiles.has(path)) fail(`unregistered implementation source under app root: ${path}`);
for (const path of allowedSourceFiles.keys()) if (!discoveredAppSource.has(path)) fail(`stale app-source allowlist entry: ${path}`);
info.push(`${discoveredAppSource.size} app implementation-source files are exactly allowlisted`);

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
    if (matching.length !== 1) fail(`${projectPath}: expected exactly one ${dimension.slice(0, -1)} tag, found ${matching.length}`);
  }
}
info.push(`${(appSourceRegistry.requiredTaggedProjects ?? []).length} projects have three-dimensional tags`);

const symlinkRoots = new Set([workspacePath("apps")]);
for (const projectPath of appSourceRegistry.requiredTaggedProjects ?? []) symlinkRoots.add(dirname(workspacePath(projectPath)));
for (const symlinkRoot of symlinkRoots)
{
  walk(symlinkRoot, function inspectSymlink(path, stat) {
    if (stat.isSymbolicLink()) fail(`symlink/forwarder path is forbidden: ${normalizedRelative(path)}`);
  });
}

if (errors.length > 0)
{
  process.stderr.write("Workload-ownership and app-composition boundary guard failed:\n");
  for (const error of errors) process.stderr.write(`  - ${error}\n`);
  process.exit(1);
}

process.stdout.write("Workload-ownership and app-composition boundary guard passed.\n");
for (const line of info) process.stdout.write(`  - ${line}\n`);
process.stdout.write(`  - ${workloadIds.size} workload classes have exact app owners\n`);
