import { handle, ok, fail, type Ctx } from "@/lib/http";
import { read } from "@/lib/store";
import { updateWorkspace } from "@/lib/repo";
import {
  checkTools,
  getStatus,
  hotReload,
  isFlutterWorkspace,
  isMac,
  listDevices,
  openSimulatorWindow,
  pickDevice,
  startApp,
  stopApp,
} from "@/lib/simulator";

export const runtime = "nodejs";
type P = Ctx<{ id: string }>;

/** Simulator status for the preview panel. `?full=1` also lists devices and checks tools. */
export const GET = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const db = await read();
  const ws = db.workspaces.find((w) => w.id === id);
  if (!ws) return fail("Workspace not found", 404);
  const flutter = await isFlutterWorkspace(ws);
  const status = getStatus(id);
  if (!new URL(req.url).searchParams.get("full")) return ok({ flutter, isMac, ...status });
  const [tools, devices] = await Promise.all([checkTools(), listDevices().catch(() => [])]);
  return ok({
    flutter,
    isMac,
    ...status,
    tools,
    devices,
    selectedUdid: status.udid ?? (await pickDevice(ws.simulatorUdid).catch(() => null)),
    autoRun: ws.autoRunSimulator !== false,
  });
});

export const POST = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const body = (await req.json()) as { action: "run" | "reload" | "restart" | "stop" | "open" | "settings"; udid?: string; autoRun?: boolean };
  switch (body.action) {
    case "run":
      if (body.udid) await updateWorkspace(id, { simulatorUdid: body.udid });
      return ok(await startApp(id, { udid: body.udid }));
    case "reload":
    case "restart":
      if (!hotReload(id, body.action === "restart")) return ok(await startApp(id, { udid: body.udid }));
      return ok(getStatus(id));
    case "stop":
      await stopApp(id);
      return ok(getStatus(id));
    case "open": {
      const udid = getStatus(id).udid ?? body.udid;
      if (!udid) return fail("Run the app first.");
      await openSimulatorWindow(udid);
      return ok({ opened: true });
    }
    case "settings":
      await updateWorkspace(id, {
        ...(body.udid ? { simulatorUdid: body.udid } : {}),
        ...(body.autoRun !== undefined ? { autoRunSimulator: body.autoRun } : {}),
      });
      return ok({ saved: true });
  }
  return fail("Unknown action");
});
