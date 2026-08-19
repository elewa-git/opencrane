---
description: Prepare or release an explicitly selected OpenCrane medium/major candidate through immutable, upgrade-safe qualification.
argument-hint: "[readiness|release] <selected PRs or version> [target environment when deployment is authorized]"
---

You are orchestrating an exceptional OpenCrane release-management run. The caller's
request is: **$ARGUMENTS**.

Delegate this run to the `release-manager` agent. Pass the exact user request without
expanding its authority. The agent returns the activation receipt and owns the stop/go
decision.

The gate order is fixed:

1. admit the explicit readiness or release request and freeze the complete tag-to-tip candidate;
2. converge reviewed repair PRs and validate the immutable release composition;
3. commit the capability-first changelog, then qualify fresh installation and exact predecessor upgrade on one SHA;
4. when deployment is explicitly authorized, lock inputs and delegate the sole cluster-writing step to `deploy`;
5. recheck live proof, then create a final tag only when tag authority is also explicit; and
6. append the deploy ledger and close the plan only after the deployed state matches the immutable candidate.

Do not invoke this workflow for ordinary PRs, ordinary CI repairs, or unqualified deployment
requests. A readiness run ends at `READY`; a deploy request does not authorize a tag.
