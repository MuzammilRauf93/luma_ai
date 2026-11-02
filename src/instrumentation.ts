/** Runs once when a Luma server process starts (Next.js instrumentation hook). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { boot } = await import("./lib/runtime");
  await boot();
}
