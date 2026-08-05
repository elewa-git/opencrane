import { stackChain } from "./topology.mjs";

/** Parse PR numbers from the first level-two Review order section. */
export function parseReviewOrder(body)
{
	const heading = /^## Review order\s*$/imu;
	const match = heading.exec(body);
	if (!match)
	{
		return [];
	}
	const remainder = body.slice(match.index + match[0].length);
	const end = remainder.search(/^##\s+/mu);
	const section = end === -1 ? remainder : remainder.slice(0, end);
	return Array.from(section.matchAll(/#(\d+)/gu), function _Number(entry) { return Number(entry[1]); });
}

/** Validate the event PR's declared review order against its live component. */
export function reviewOrderFindings(current, currentChain, topology)
{
	if (!current || currentChain.length <= 1)
	{
		return [];
	}
	const findings = [];
	const declaredOrder = parseReviewOrder(current.body);
	const positions = new Map();
	for (let index = 0; index < declaredOrder.length; index += 1)
	{
		const number = declaredOrder[index];
		if (positions.has(number))
		{
			findings.push({ code: "DUPLICATE_REVIEW_ENTRY", message: `#${current.number}'s review order repeats #${number}.` });
		}
		positions.set(number, index);
	}
	for (const number of currentChain)
	{
		if (!positions.has(number))
		{
			findings.push({ code: "MISSING_REVIEW_ENTRY", message: `#${current.number}'s review order omits open ancestor #${number}.` });
		}
	}
	for (let index = 1; index < currentChain.length; index += 1)
	{
		if ((positions.get(currentChain[index - 1]) ?? Infinity) > (positions.get(currentChain[index]) ?? -1))
		{
			findings.push({ code: "REVERSED_REVIEW_ORDER", message: `#${current.number}'s review order does not put parents before children.` });
			break;
		}
	}
	const component = new Set(currentChain);
	for (const number of declaredOrder)
	{
		if (topology.byNumber.has(number) && !component.has(number)
			&& !stackChain(number, topology.parents).includes(current.number))
		{
			findings.push({ code: "CROSS_COMPONENT_REVIEW_ENTRY", message: `#${current.number}'s review order includes unrelated open #${number}.` });
		}
	}
	return findings;
}
