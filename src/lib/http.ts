import { NextResponse } from "next/server";
import { authorize, HttpError, runWithUser } from "./auth";

export function ok<T>(data: T, init?: number) {
  return NextResponse.json(data, { status: init ?? 200 });
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Wrap a route handler: checks sign-in and workspace permissions (Phase 5) and turns thrown
 * errors into JSON responses instead of 500 pages.
 */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      const req = args[0] as Request;
      const ctx = await authorize(req);
      return await runWithUser(ctx, () => fn(...args));
    } catch (err) {
      if (err instanceof HttpError) return fail(err.message, err.status);
      const message = err instanceof Error ? err.message : String(err);
      const status = /not found/i.test(message) ? 404 : 400;
      return fail(message, status);
    }
  };
}

/** For streaming/binary routes that don't use `handle`: returns an error Response or null. */
export async function guard(req: Request): Promise<{ error: Response } | { run: <T>(fn: () => T) => T }> {
  try {
    const ctx = await authorize(req);
    return { run: (fn) => runWithUser(ctx, fn) };
  } catch (err) {
    if (err instanceof HttpError) return { error: fail(err.message, err.status) };
    throw err;
  }
}

export type Ctx<P extends Record<string, string | string[] | undefined>> = { params: Promise<P> };
