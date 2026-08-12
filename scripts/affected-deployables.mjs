#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

import {
  selectAffectedDeployables,
  selectApiContractChanged,
  selectDevelopSmokeImages,
  selectDevelopSmokeInputsChanged,
  selectDevelopSmokeProjects,
  selectDevelopSmokeStorageMode,
  selectForcedContainerProjects,
  selectGuardInputsChanged,
  selectImageSmokeProjects,
} from "./affected-deployables.core.mjs";

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

/** Lists all NX projects that own a named target. */
function _Projects(target)
{
  return JSON.parse(_run("npx", ["nx", "show", "projects", `--withTarget=${target}`, "--json"]));
}

function _ContainerProjects()
{
  const forced = selectForcedContainerProjects(process.env.FORCE_DEPLOYABLES);
  if (forced !== null) return forced;
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
const affectedContainerProjects = _AffectedProjects("container");
const publishContainerProjects = _ContainerProjects();
const allContainerProjects = _Projects("container").map(function _Config(project) { return _Project(project); });
const deployables = selectAffectedDeployables(publishContainerProjects.map(function _Config(project) { return _Project(project); }));
const developSmokeImages = selectDevelopSmokeImages(allContainerProjects);
const developSmokeProjects = selectDevelopSmokeProjects(affectedContainerProjects);
const imageSmokes = selectImageSmokeProjects(
  _AffectedProjects("image-smoke"),
  _Projects("image-smoke"),
  process.env.FORCE_HEAVY_QUALIFICATION,
);
const changedFiles = _run("git", ["diff", "--name-only", base, head]).split("\n").filter(Boolean);

const apiContractChanged = selectApiContractChanged(affectedProjects);
const developSmokeInputsChanged = selectDevelopSmokeInputsChanged(changedFiles);
const developSmokeStorageMode = selectDevelopSmokeStorageMode(
  changedFiles,
  process.env.GITHUB_EVENT_NAME,
  process.env.GITHUB_REF,
  process.env.FORCE_HEAVY_QUALIFICATION,
);
const guardInputsChanged = selectGuardInputsChanged(changedFiles);

_output("nx_base", base);
_output("nx_head", head);
_output("deployables", JSON.stringify({ include: deployables }));
_output("has_deployables", String(deployables.length > 0));
_output("image_smokes", JSON.stringify({ include: imageSmokes }));
_output("has_image_smokes", String(imageSmokes.length > 0));
_output("develop_smoke_images", JSON.stringify({ include: developSmokeImages }));
_output("develop_smoke_projects", developSmokeProjects.join(","));
_output("affected_container_projects", affectedContainerProjects.join(","));
_output("api_contract_changed", String(apiContractChanged));
_output("develop_smoke_inputs_changed", String(developSmokeInputsChanged));
_output("develop_smoke_storage_mode", developSmokeStorageMode);
_output("guard_inputs_changed", String(guardInputsChanged));
