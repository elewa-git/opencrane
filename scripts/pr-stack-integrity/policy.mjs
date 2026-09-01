import { reviewOrderFindings } from "./review-order.mjs";
import { buildTopology, stackChain } from "./topology.mjs";

/** Evaluate ancestry, absorption, replay, event, and review-order policy. */
export function evaluateStack(input)
{
	const topology = buildTopology(input.pullRequests, input.integrationBranches, input.mergedPullRequests);
	const findings = [...topology.findings];
	for (const [childNumber, parentNumber] of topology.parents)
	{
		if (!input.ancestry.has(`${parentNumber}:${childNumber}`))
		{
			findings.push({
				code: "NON_ANCESTRAL_PARENT",
				message: `#${parentNumber} is not a Git ancestor of its child #${childNumber}.`,
			});
		}
	}

	for (const left of input.pullRequests)
	{
		for (const right of input.pullRequests)
		{
			if (left.number >= right.number || !input.patchIds.get(left.number))
			{
				continue;
			}
			if (input.patchIds.get(left.number) === input.patchIds.get(right.number))
			{
				findings.push({
					code: "DUPLICATE_PATCH",
					message: `#${left.number} and #${right.number} carry the same incremental patch.`,
				});
			}
		}
	}

	for (const possibleAncestor of input.pullRequests)
	{
		for (const current of input.pullRequests)
		{
			if (possibleAncestor.number === current.number
				|| !input.ancestry.has(`${possibleAncestor.number}:${current.number}`))
			{
				continue;
			}
			if (!stackChain(current.number, topology.parents).includes(possibleAncestor.number))
			{
				findings.push({
					code: "UNDECLARED_ABSORPTION",
					message: `#${current.number} contains open #${possibleAncestor.number} without stacking on it; stack them or close the absorbed PR.`,
				});
			}
		}
	}

	const current = input.event?.action === "closed"
		? undefined
		: topology.byNumber.get(input.event?.number);
	if (input.event?.number && input.event.action !== "closed" && !current)
	{
		findings.push({ code: "EVENT_PR_MISSING", message: `Event PR #${input.event.number} is absent from the open snapshot.` });
	}
	if (current && input.event.headSha && current.head.sha !== input.event.headSha)
	{
		findings.push({
			code: "EVENT_HEAD_DRIFT",
			message: `Event head ${input.event.headSha} does not match live head ${current.head.sha} for #${current.number}.`,
		});
	}
	const currentChain = current ? stackChain(current.number, topology.parents) : [];
	for (const pullRequest of input.pullRequests)
	{
		findings.push(...reviewOrderFindings(
			pullRequest,
			stackChain(pullRequest.number, topology.parents),
			topology,
		));
	}
	return { topology, current, currentChain, findings };
}
