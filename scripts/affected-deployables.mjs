#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const _deployables = [
  { project: "opencrane", image: "opencrane-server", dockerfile: "apps/opencrane/deploy/Dockerfile" },
  { project: "channel-proxy", image: "opencrane-channel-proxy", dockerfile: "apps/channel-proxy/deploy/Dockerfile" },
  { project: "artifact-service", image: "opencrane-artifact-service", dockerfile: "apps/artifact-service/deploy/Dockerfile" },
  { project: "feat-openclaw-tenant", image: "opencrane-openclaw-tenant", dockerfile: "apps/feat-openclaw-tenant/deploy/Dockerfile" },
  { project: "opencrane-ui", image: "opencrane-ui", dockerfile: "apps/opencrane-ui/deploy/Dockerfile" },
];

/** Run a command and return trimmed stdout. */
function _run(command, args)
{
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

/** Write one GitHub Actions output when running in CI. */
function _output(name, value)
{
  if (process.env.GITHUB_OUTPUT)
  {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
  else
  {
    process.stdout.write(`${name}=${value}\n`);
  }
}

const base = process.env.NX_BASE;
const head = process.env.NX_HEAD;

if (!base || !head)
{
  throw new Error("NX_BASE and NX_HEAD must be set before selecting affected deployables.");
}

const affected = new Set(JSON.parse(_run("npx", ["nx", "show", "projects", "--affected", "--withTarget=container", "--json"])));
const knownProjects = new Set(_deployables.map(function _project(entry) { return entry.project; }));

for (const project of affected)
{
  if (!knownProjects.has(project))
  {
    throw new Error(`Affected container project '${project}' has no publish descriptor in scripts/affected-deployables.mjs.`);
  }
}

const deployables = _deployables.filter(function _affected(entry) { return affected.has(entry.project); });
const changedFiles = _run("git", ["diff", "--name-only", base, head]).split("\n").filter(Boolean);

// The deployment surface: umbrella + substrate charts, app-owned charts/deploy units, and the
// pipeline itself. Only changes here can alter what a cluster receives, so only they require the
// k3d e2e on pull requests — pushes to the integration branches always run it, and the nightly
// workflow covers everything else.
const platformChanged = changedFiles.some(function _platform(file) {
  return file.startsWith("apps/_infra/")
    || (file.startsWith("apps/") && (file.includes("/helm/") || file.includes("/deploy/")))
    || file === ".github/workflows/docker.yml";
});
const apiContractChanged = affected.has("opencrane") || affected.has("contracts");
const e2eRequired = platformChanged;

// The topology negative tests exercise the guard, not the repo: re-prove the guard only when the
// guard, its registries, a chart, or the pipeline change.
const guardInputsChanged = changedFiles.some(function _guard(file) {
  return file.startsWith("scripts/phase-b-topology")
    || file === "docs/agents/workload-ownership.json"
    || file === "docs/agents/app-source-allowlist.json"
    || file.includes("/helm/")
    || file === ".github/workflows/docker.yml";
});

_output("nx_base", base);
_output("nx_head", head);
_output("deployables", JSON.stringify({ include: deployables }));
_output("has_deployables", String(deployables.length > 0));
_output("api_contract_changed", String(apiContractChanged));
_output("e2e_required", String(e2eRequired));
_output("guard_inputs_changed", String(guardInputsChanged));
