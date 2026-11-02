import { handle, ok } from "@/lib/http";
import { clearCookie, endSession } from "@/lib/auth";

export const runtime = "nodejs";

export const POST = handle(async (req: Request) => {
  await endSession(req);
  const res = ok({ signedOut: true });
  res.headers.set("Set-Cookie", clearCookie());
  return res;
});
