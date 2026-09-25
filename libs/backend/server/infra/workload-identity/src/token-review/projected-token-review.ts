import * as k8s from "@kubernetes/client-node";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import type { ProjectedTokenReviewApi } from "./workload-identity.types";

/** Submit one audience-bound credential and expose only an authenticated matching TokenReview. */
export async function _ReviewProjectedToken(authApi: ProjectedTokenReviewApi, token: string, audiences: readonly string[]): Promise<k8s.V1TokenReviewStatus | null>
{
	return ___DoWithTrace("kubernetes.projected_token.review", { audienceClasses: audiences.length }, async function _reviewToken(): Promise<k8s.V1TokenReviewStatus | null>
	{
		const body = new k8s.V1TokenReview();
		body.spec = new k8s.V1TokenReviewSpec();
		body.spec.token = token;
		body.spec.audiences = [...audiences];
		const review = await authApi.createTokenReview({ body });
		const status = review.status;
		return status?.authenticated && status.audiences?.some(function _accepted(audience) { return audiences.includes(audience); }) ? status : null;
	});
}
