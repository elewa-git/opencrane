#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

import { selectAffectedDeployables, selectApiContractChanged, selectGuardInputsChanged } from "./affected-deployables.core.mjs";

/** Run a command and return trimmed stdout. */
function _run(command, args)
{
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

/** Lists affected NX project names, optionally limited to a target. */
function _AffectedProjects(target)
{
  const targetArguments = target ? [`--withTarget=${target}`] : [];
  return JSON.parse(_run("npx", ["nx", "show", "projects", "--affected", ...targetArguments, "--json"]));
}

function _ContainerProjects()
{
  if (process.env.FORCE_DEPLOYABLES === "bootstrap")
  {
    return ["channel-proxy", "memory-gateway"];
  }
  return _AffectedProjects("container");
}

/** Reads the complete app-owned project configuration from the NX graph. */
function _Project(project)
{
  return JSON.parse(_run("npx", ["nx", "show", "project", project, "--json"]));
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

const affectedProjects = _AffectedProjects();
const affectedContainerProjects = _ContainerProjects();
const deployables = selectAffectedDeployables(affectedContainerProjects.map(function _Config(project) { return _Project(project); }));
const changedFiles = _run("git", ["diff", "--name-only", base, head]).split("\n").filter(Boolean);

const apiContractChanged = selectApiContractChanged(affectedProjects);
const guardInputsChanged = selectGuardInputsChanged(changedFiles);

_output("nx_base", base);
_output("nx_head", head);
_output("deployables", JSON.stringify({ include: deployables }));
_output("has_deployables", String(deployables.length > 0));
_output("api_contract_changed", String(apiContractChanged));
_output("guard_inputs_changed", String(guardInputsChanged));
