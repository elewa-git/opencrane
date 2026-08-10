import { Router } from "express";

/**
 * Serve a pre-assembled OpenAPI 3.1 specification at `GET /`. Mount it under `/openapi.json`.
 * No authentication required — the spec is a public contract document. The `spec` is injected
 * (each app assembles its own) so this router is app-agnostic.
 *
 * @param spec - The assembled OpenAPI document to serve.
 * @returns An Express Router that returns the spec as JSON.
 */
export function _OpenapiRouter(spec: unknown): Router
{
  const router = Router();

  router.get("/", function _getOpenApiSpec(_req, res)
  {
    res.json(spec);
  });

  return router;
}
