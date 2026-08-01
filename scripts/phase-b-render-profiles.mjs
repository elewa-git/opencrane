import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [, , root, workloadRegistryPath, chartPath] = process.argv;
const errors = [];
const renderedWorkloadKindPattern = /^kind:\s*(Pod|Deployment|StatefulSet|DaemonSet|CronJob|Job)\s*$/m;
const workloadRegistry = JSON.parse(readFileSync(workloadRegistryPath, "utf8"));
const renderedPodClasses = new Set(
  (workloadRegistry.workloads ?? [])
    .map(function renderedPodClass(workload) { return workload.renderedPodClass; })
    .filter(Boolean),
);
const renderedAcrossProfiles = new Set();

function fail(message)
{
  errors.push(message);
}

for (const profile of workloadRegistry.renderProfiles ?? [])
{
  const context = `render profile '${profile.id ?? "<missing>"}'`;
  if (!profile.id) fail(`${context}: id is required`);
  const args = [
    "template",
    "opencrane",
    chartPath,
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
    if (!renderedPodClasses.has(podClass)) fail(`${context}: unregistered rendered pod class ${podClass}`);
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
for (const podClass of renderedPodClasses)
{
  if (!renderedAcrossProfiles.has(podClass)) fail(`registered rendered pod class is absent from every profile: ${podClass}`);
}

if (errors.length > 0)
{
  for (const error of errors) process.stderr.write(`${error}\n`);
  process.exit(1);
}

process.stdout.write(`${(workloadRegistry.renderProfiles ?? []).length} Helm profiles match their exact pod-class inventories\n`);
