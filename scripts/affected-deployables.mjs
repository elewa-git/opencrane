#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const _deployables = [
  { project: "opencrane", image: "opencrane-server", dockerfile: "apps/opencrane/deploy/Dockerfile" },
  { project: "feat-openclaw-tenant", image: "opencrane-openclaw-tenant", dockerfile: "apps/feat-openclaw-tenant/deploy/Dockerfile" },
  { project: "feat-skill-registry", image: "opencrane-skills-registry", dockerfile: "apps/feat-skill-registry/deploy/Dockerfile" },
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
const platformChanged = changedFiles.some(function _platform(file) {
  return file.startsWith("apps/opencrane-infra/") || file.startsWith("libs/k8s-platform/");
});
const apiContractChanged = affected.has("opencrane") || affected.has("contracts");
const e2eRequired = platformChanged || affected.has("opencrane") || affected.has("feat-skill-registry");

_output("nx_base", base);
_output("nx_head", head);
_output("deployables", JSON.stringify({ include: deployables }));
_output("has_deployables", String(deployables.length > 0));
_output("api_contract_changed", String(apiContractChanged));
_output("e2e_required", String(e2eRequired));
