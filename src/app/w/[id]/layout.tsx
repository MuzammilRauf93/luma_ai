"use client";

import { use } from "react";
import Link from "next/link";
import { WorkspaceProvider, useWorkspace } from "@/components/WorkspaceProvider";
import { TicketPanel } from "@/components/TicketPanel";
import { Tour } from "@/components/Tour";

export default function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <WorkspaceProvider id={id}>
      <Gate>{children}</Gate>
      <TicketPanel />
      <Tour workspaceId={id} />
    </WorkspaceProvider>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const { notFound } = useWorkspace();
  if (notFound)
    return (
      <div className="p-10 text-center">
        <h2 className="font-semibold">Workspace not found</h2>
        <Link href="/" className="btn mt-4">Back home</Link>
      </div>
    );
  return <>{children}</>;
}
