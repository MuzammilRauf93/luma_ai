import { handle, ok, fail, type Ctx } from "@/lib/http";
import { deleteSecret, listSecrets, setSecret } from "@/lib/secrets";

export const runtime = "nodejs";
type P = Ctx<{ id: string }>;

/** Names and hints only: values never leave the server. */
export const GET = handle(async (_req: Request, { params }: P) => {
  const { id } = await params;
  return ok({ secrets: await listSecrets(id) });
});

export const PUT = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const { name, value } = (await req.json()) as { name?: string; value?: string };
  if (!name) return fail("Enter a name.");
  return ok({ secret: await setSecret(id, name, value ?? "") });
});

export const DELETE = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const name = new URL(req.url).searchParams.get("name");
  if (!name) return fail("Which secret?");
  await deleteSecret(id, name);
  return ok({ deleted: true });
});
