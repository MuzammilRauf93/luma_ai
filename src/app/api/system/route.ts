import { handle, ok, fail } from "@/lib/http";
import { diagnostics, installJob, installPackage, pinSecret, restart, testDatabase, writeConfig } from "@/lib/system";

export const runtime = "nodejs";

/** Settings → System (admins): diagnostics, install status. */
export const GET = handle(async () => ok({ ...(await diagnostics()), install: installJob() }));

type Body =
  | { action: "install"; pkg: string }
  | { action: "config"; values: Record<string, string | null> }
  | { action: "pinSecret" }
  | { action: "testDb"; url: string }
  | { action: "restart" };

export const POST = handle(async (req: Request) => {
  const b = (await req.json()) as Body;
  switch (b.action) {
    case "install":
      return ok({ install: installPackage(b.pkg) });
    case "config":
      await writeConfig(b.values);
      return ok({ saved: true, restartRequired: true });
    case "pinSecret":
      return ok(await pinSecret());
    case "testDb":
      return ok({ server: await testDatabase(b.url) });
    case "restart":
      return ok(restart());
    default:
      return fail("Unknown action");
  }
});
