import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("organization invitation continuation", function _OrganizationInvitationContinuationSuite()
{
	it.each(["Success", "AlreadyUsed"])("continues the %s state through onboarding", function _ContinuesThroughOnboarding(state)
	{
		const template = readFileSync(join(process.cwd(), "src/lib/invite/organization-invite-acceptance-view.component.html"), "utf8");
		const branch = template.match(new RegExp(`@case \\(states\\.${state}\\) \\{[\\s\\S]*?(?=\\n\\s*@case)`, "u"))?.[0];

		expect(branch).toContain('routerLink="/onboarding"');
		expect(branch).toContain("Continue setup");
		expect(branch).not.toContain('routerLink="/chats"');
	});
});
