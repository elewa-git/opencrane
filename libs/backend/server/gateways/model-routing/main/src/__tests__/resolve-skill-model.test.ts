import { AutoRoutingObjective, SkillModelMode, type AutoRoutingConfig } from "@opencrane/contracts";
import { describe, expect, it } from "vitest";

import { _ResolveSkillModel } from "../core/resolve-skill-model.js";
import type { ScopeDefaults, SkillModelPosture } from "../core/resolve-skill-model.types.js";

/** A minimal valid auto-routing config for posture/default inputs. */
function _autoConfig(): AutoRoutingConfig
{
  return { objective: AutoRoutingObjective.Balanced, sessionPin: true, explorationRate: 0 };
}

/** Build a posture with sensible nulls so each case only sets what it exercises. */
function _posture(over: Partial<SkillModelPosture>): SkillModelPosture
{
  return { modelMode: null, pinnedModel: null, autoConfig: null, ...over };
}

/** Build scope defaults with sensible nulls. */
function _defaults(over: Partial<ScopeDefaults>): ScopeDefaults
{
  return { clusterTenant: null, global: null, ...over };
}

describe("_ResolveSkillModel precedence", function _suite()
{
  it("skill-pinned wins over every scope default", function _pinnedWins()
  {
    const result = _ResolveSkillModel(
      _posture({ modelMode: SkillModelMode.Pinned, pinnedModel: "openai/gpt-4o" }),
      _defaults({
        clusterTenant: { defaultModel: "ct/model", autoConfig: null },
        global: { defaultModel: "global/model", autoConfig: null },
      }),
    );

    expect(result).toEqual({ model: "openai/gpt-4o", auto: false, autoConfig: null, source: "skill-pinned" });
  });

  it("skill-auto anchors on the ClusterTenant default model and carries the skill's auto config", function _autoUsesCt()
  {
    const config = _autoConfig();
    const result = _ResolveSkillModel(
      _posture({ modelMode: SkillModelMode.Auto, autoConfig: config }),
      _defaults({
        clusterTenant: { defaultModel: "ct/model", autoConfig: null },
        global: { defaultModel: "global/model", autoConfig: null },
      }),
    );

    expect(result.auto).toBe(true);
    expect(result.model).toBe("ct/model");
    expect(result.autoConfig).toBe(config);
    expect(result.source).toBe("scope-default-cluster-tenant");
  });

  it("skill-auto with no scope default resolves model null but stays auto", function _autoNoDefault()
  {
    const config = _autoConfig();
    const result = _ResolveSkillModel(
      _posture({ modelMode: SkillModelMode.Auto, autoConfig: config }),
      _defaults({}),
    );

    expect(result).toEqual({ model: null, auto: true, autoConfig: config, source: "skill-auto" });
  });

  it("null posture inherits the ClusterTenant default over the Global default", function _nullPrefersCt()
  {
    const result = _ResolveSkillModel(
      _posture({}),
      _defaults({
        clusterTenant: { defaultModel: "ct/model", autoConfig: null },
        global: { defaultModel: "global/model", autoConfig: null },
      }),
    );

    expect(result.model).toBe("ct/model");
    expect(result.auto).toBe(false);
    expect(result.source).toBe("scope-default-cluster-tenant");
  });

  it("null posture falls back to the Global default when no ClusterTenant default names a model", function _nullFallsToGlobal()
  {
    const result = _ResolveSkillModel(
      _posture({}),
      _defaults({ global: { defaultModel: "global/model", autoConfig: null } }),
    );

    expect(result.model).toBe("global/model");
    expect(result.source).toBe("scope-default-global");
  });

  it("an empty ClusterTenant default does not shadow a usable Global default", function _emptyCtNoShadow()
  {
    const result = _ResolveSkillModel(
      _posture({}),
      _defaults({
        clusterTenant: { defaultModel: null, autoConfig: null },
        global: { defaultModel: "global/model", autoConfig: null },
      }),
    );

    expect(result.model).toBe("global/model");
    expect(result.source).toBe("scope-default-global");
  });

  it("null posture inheriting an auto scope default propagates the auto posture", function _nullInheritsAuto()
  {
    const config = _autoConfig();
    const result = _ResolveSkillModel(
      _posture({}),
      _defaults({ global: { defaultModel: "global/model", autoConfig: config } }),
    );

    expect(result.auto).toBe(true);
    expect(result.autoConfig).toBe(config);
    expect(result.model).toBe("global/model");
    expect(result.source).toBe("scope-default-global");
  });

  it("pinned mode with no pinnedModel falls through to the scope default", function _pinnedNoModelFallsThrough()
  {
    const result = _ResolveSkillModel(
      _posture({ modelMode: SkillModelMode.Pinned, pinnedModel: null }),
      _defaults({ global: { defaultModel: "global/model", autoConfig: null } }),
    );

    expect(result.model).toBe("global/model");
    expect(result.source).toBe("scope-default-global");
  });

  it("nothing resolves → model null, source unresolved", function _nothingResolves()
  {
    const result = _ResolveSkillModel(_posture({}), _defaults({}));

    expect(result).toEqual({ model: null, auto: false, autoConfig: null, source: "unresolved" });
  });
});
