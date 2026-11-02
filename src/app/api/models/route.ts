import { handle, ok } from "@/lib/http";
import { listModels } from "@/lib/anthropic";

export const runtime = "nodejs";

export const GET = handle(async () => ok({ models: await listModels() }));
