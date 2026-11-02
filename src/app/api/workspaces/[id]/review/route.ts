import { handle, ok, fail, type Ctx } from "@/lib/http";
import { addComment, aiReview, changeSets, deleteComment, listThreads, markViewed, setThreadStatus, submitVerdict } from "@/lib/review";

export const runtime = "nodejs";
type P = Ctx<{ id: string }>;

/** ?changesets=1 → tickets with changes to review; otherwise comment threads (?path=, ?ticketId=). */
export const GET = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const u = new URL(req.url).searchParams;
  if (u.get("changesets")) return ok({ changeSets: await changeSets(id) });
  return ok({ threads: await listThreads(id, { path: u.get("path"), ticketId: u.get("ticketId") }) });
});

type Body =
  | { action: "comment"; threadId?: string; path?: string; line?: number; ticketId?: string | null; text: string }
  | { action: "resolve" | "reopen"; threadId: string }
  | { action: "delete"; threadId: string; commentId?: string }
  | { action: "viewed"; ticketId: string; path: string; viewed: boolean }
  | { action: "verdict"; ticketId: string; verdict: "approve" | "request_changes"; note?: string }
  | { action: "ai"; ticketId?: string; path?: string };

export const POST = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const b = (await req.json()) as Body;
  switch (b.action) {
    case "comment":
      return ok({ thread: await addComment(id, b) }, 201);
    case "resolve":
    case "reopen":
      await setThreadStatus(id, b.threadId, b.action === "resolve" ? "resolved" : "open");
      return ok({ done: true });
    case "delete":
      await deleteComment(id, b.threadId, b.commentId);
      return ok({ done: true });
    case "viewed":
      await markViewed(id, b.ticketId, b.path, b.viewed);
      return ok({ done: true });
    case "verdict":
      return ok(await submitVerdict(id, b.ticketId, b.verdict, b.note));
    case "ai":
      return ok(await aiReview(id, b));
    default:
      return fail("Unknown action");
  }
});
