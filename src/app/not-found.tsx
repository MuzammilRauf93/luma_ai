import Link from "next/link";

export const metadata = { title: "Page not found · Luma AI" };

export default function NotFound() {
  return (
    <div className="min-h-[70vh] grid place-content-center text-center px-6">
      <p className="text-sm font-semibold text-accent-ink">404</p>
      <h1 className="text-2xl font-semibold tracking-tight mt-1">This page doesn't exist</h1>
      <p className="text-sm text-muted mt-2 max-w-sm">The link may be old, or the workspace may have been deleted or not shared with you.</p>
      <div className="flex gap-2 justify-center mt-5">
        <Link href="/" className="btn btn-primary">Go to your workspaces</Link>
        <Link href="/welcome" className="btn">Luma home</Link>
      </div>
    </div>
  );
}
