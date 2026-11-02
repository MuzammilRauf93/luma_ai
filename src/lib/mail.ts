import "server-only";
import { createRequire } from "module";
import path from "path";
import { mutate, now, read } from "./store";
import { decrypt } from "./crypto";
import type { Notification } from "./types";

/**
 * Email (Phase 6) through your own SMTP server (Gmail/Google Workspace, Microsoft 365,
 * SendGrid, Postmark, Mailgun…). Uses the optional `nodemailer` package. Configure in
 * Settings → Email, or with LUMA_SMTP_URL (smtp://user:pass@host:587) + LUMA_MAIL_FROM.
 * Used for invites, password resets and notification emails (instant or a daily digest).
 */

type Transport = { sendMail: (m: Record<string, unknown>) => Promise<{ messageId?: string }>; verify?: () => Promise<unknown> };

async function config() {
  const db = await read();
  const e = db.settings.email;
  if (process.env.LUMA_SMTP_URL) {
    return { url: process.env.LUMA_SMTP_URL, from: process.env.LUMA_MAIL_FROM || e?.from || "Luma AI <luma@localhost>", appUrl: process.env.LUMA_APP_URL || db.settings.appUrl };
  }
  if (!e?.host) return null;
  return {
    host: e.host,
    port: e.port,
    secure: e.secure,
    user: e.user,
    pass: e.pass ? await decrypt(e.pass).catch(() => undefined) : undefined,
    from: e.from,
    appUrl: process.env.LUMA_APP_URL || db.settings.appUrl,
  };
}

export async function emailConfigured() {
  return (await config()) !== null;
}

async function transport(): Promise<{ t: Transport; from: string; appUrl?: string } | null> {
  const c = await config();
  if (!c) return null;
  let nodemailer: { createTransport: (opts: unknown) => Transport };
  try {
    nodemailer = createRequire(path.join(process.cwd(), "package.json"))("nodemailer");
  } catch {
    throw new Error("Email needs the nodemailer package: install it in Settings → System.");
  }
  const t =
    "url" in c && c.url
      ? nodemailer.createTransport(c.url)
      : nodemailer.createTransport({
          host: (c as { host: string }).host,
          port: (c as { port: number }).port,
          secure: (c as { secure: boolean }).secure,
          auth: (c as { user?: string }).user ? { user: (c as { user: string }).user, pass: (c as { pass?: string }).pass } : undefined,
        });
  return { t, from: c.from, appUrl: c.appUrl };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

function layout(title: string, bodyHtml: string, cta?: { label: string; url: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1917">
<div style="max-width:520px;margin:24px auto;background:#fff;border-radius:14px;padding:28px;border:1px solid #e7e5e4">
<div style="font-weight:700;margin-bottom:18px"><span style="display:inline-block;width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,#7c3aed,#db2777);color:#fff;text-align:center;line-height:22px;font-size:12px;margin-right:6px">L</span>Luma AI</div>
<h1 style="font-size:18px;margin:0 0 12px">${esc(title)}</h1>
${bodyHtml}
${cta ? `<p style="margin:22px 0 4px"><a href="${esc(cta.url)}" style="background:#7c3aed;color:#fff;text-decoration:none;padding:10px 16px;border-radius:999px;font-weight:600;display:inline-block">${esc(cta.label)}</a></p>` : ""}
<p style="color:#78716c;font-size:12px;margin-top:24px">You get this because you use Luma AI. Change email settings in Luma → Settings → Profile.</p>
</div></body></html>`;
}

/** Send one email. Returns false (without throwing) when email isn't set up. */
export async function sendMail(to: string, subject: string, html: string, text: string) {
  const tr = await transport();
  if (!tr) return false;
  await tr.t.sendMail({ from: tr.from, to, subject, html, text });
  return true;
}

export async function appUrl(fallback?: string) {
  return (await config())?.appUrl || fallback || "http://localhost:3000";
}

export async function sendInviteEmail(to: string, link: string, opts: { inviter?: string; workspace?: string }) {
  const what = opts.workspace ? `the “${opts.workspace}” workspace` : "Luma AI";
  const title = `${opts.inviter ?? "Someone"} invited you to ${what}`;
  return sendMail(to, title, layout(title, `<p>Luma is a workspace where a team of AI agents plans, builds and ships projects with you.</p><p style="color:#78716c;font-size:13px">The link works once and expires in 7 days.</p>`, { label: "Accept invite", url: link }), `${title}\n\nAccept: ${link}\n(The link works once and expires in 7 days.)`);
}

export async function sendResetEmail(to: string, link: string) {
  const title = "Reset your Luma password";
  return sendMail(to, title, layout(title, `<p>Someone (hopefully you) asked to reset your password. This link works once, for one hour. If it wasn't you, you can ignore this email.</p>`, { label: "Choose a new password", url: link }), `${title}\n\n${link}\n\nThe link works once, for one hour. If you didn't ask, ignore this email.`);
}

/** Email important notifications right away to people who chose "instant" (the default). */
export async function sendInstant(list: Notification[]) {
  if (!list.length || !(await emailConfigured())) return;
  const { isImportant } = await import("./notifications");
  const db = await read();
  const base = await appUrl();
  for (const n of list) {
    if (!isImportant(n.kind) || n.emailedAt) continue;
    const u = db.users.find((x) => x.id === n.userId);
    if (!u || (u.notifyEmail ?? "instant") !== "instant") continue;
    const ws = db.workspaces.find((w) => w.id === n.workspaceId);
    try {
      await sendMail(u.email, n.title, layout(n.title, `<p>${esc(n.body)}</p><p style="color:#78716c;font-size:13px">${esc(ws ? `${ws.icon} ${ws.name}` : "")}</p>`, { label: "Open in Luma", url: base + n.link }), `${n.title}\n\n${n.body}\n\n${base + n.link}`);
      await mutate((d) => {
        const x = d.notifications.find((y) => y.id === n.id);
        if (x) x.emailedAt = now();
      });
    } catch (err) {
      console.error("[luma mail] instant email failed:", (err as Error).message);
    }
  }
}

/** Once a day (after 8:00 server time): a digest of unread notifications for people who chose "daily". */
export async function sendDigests() {
  if (!(await emailConfigured())) return;
  const db = await read();
  const nowD = new Date();
  if (nowD.getHours() < 8) return;
  const today = nowD.toISOString().slice(0, 10);
  const base = await appUrl();
  for (const u of db.users) {
    if ((u.notifyEmail ?? "instant") !== "daily" || u.lastDigestAt?.slice(0, 10) === today) continue;
    const since = u.lastDigestAt ?? new Date(Date.now() - 864e5).toISOString();
    const items = db.notifications.filter((n) => n.userId === u.id && !n.readAt && n.createdAt > since);
    await mutate((d) => {
      const x = d.users.find((y) => y.id === u.id);
      if (x) x.lastDigestAt = now();
    });
    if (!items.length) continue;
    const title = `${items.length} thing${items.length > 1 ? "s" : ""} waiting for you in Luma`;
    const rows = items
      .slice(0, 25)
      .map((n) => `<li style="margin:0 0 10px"><a href="${esc(base + n.link)}" style="color:#5b21b6;font-weight:600">${esc(n.title)}</a><br><span style="color:#57534e;font-size:13px">${esc(n.body.slice(0, 160))}</span></li>`)
      .join("");
    try {
      await sendMail(u.email, title, layout(title, `<ul style="padding-left:18px">${rows}</ul>`, { label: "Open Luma", url: base }), items.map((n) => `- ${n.title}: ${base + n.link}`).join("\n"));
    } catch (err) {
      console.error("[luma mail] digest failed:", (err as Error).message);
    }
  }
}
