import type { NextFunction, Request, Response } from "express";

/** Typed public-route handler that receives one Zod-validated request body. */
export type ValidatedPublicBodyHandler<T> = (request: Request, response: Response, next: NextFunction, body: T) => void | Promise<void>;
