// Conexão do WhatsApp (Evolution API v2) — roda só no servidor (Vercel).
// A API key da Evolution nunca chega ao navegador.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const EVO_URL = (process.env.EVOLUTION_API_URL ?? "").replace(/\/+$/, "");
const EVO_KEY = process.env.EVOLUTION_API_KEY ?? "";
const INSTANCE = process.env.EVOLUTION_INSTANCE ?? "reginaldo";
const WEBHOOK = process.env.N8N_WEBHOOK_URL ?? "";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

async function authorized(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return false;
  const { data } = await supabase.auth.getUser(token);
  return !!data.user;
}

async function evo(path: string, init: RequestInit = {}) {
  const res = await fetch(`${EVO_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", apikey: EVO_KEY, ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body: body as Record<string, any> };
}

const webhookConfig = () => ({
  enabled: true,
  url: WEBHOOK,
  byEvents: false,
  base64: true,
  events: ["MESSAGES_UPSERT"],
});

async function state() {
  const r = await evo(`/instance/connectionState/${INSTANCE}`);
  if (r.status === 404) return { exists: false, state: "nao_criada" };
  if (!r.ok) return { exists: false, state: "erro", error: r.body };
  const s = r.body?.instance?.state ?? r.body?.state ?? "close";
  let number: string | null = null;
  let profileName: string | null = null;
  if (s === "open") {
    const f = await evo(`/instance/fetchInstances?instanceName=${INSTANCE}`);
    const inst = Array.isArray(f.body) ? f.body[0] : null;
    number = inst?.ownerJid?.split("@")[0] ?? inst?.instance?.owner?.split("@")[0] ?? null;
    profileName = inst?.profileName ?? inst?.instance?.profileName ?? null;
  }
  return { exists: true, state: s, number, profileName };
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  if (!EVO_URL || !EVO_KEY) return NextResponse.json({ error: "Evolution API não configurada (EVOLUTION_API_URL / EVOLUTION_API_KEY)." }, { status: 500 });
  return NextResponse.json({ instance: INSTANCE, webhook: WEBHOOK || null, ...(await state()) });
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  if (!EVO_URL || !EVO_KEY) return NextResponse.json({ error: "Evolution API não configurada." }, { status: 500 });
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };

  if (action === "connect") {
    const s = await state();
    if (!s.exists) {
      const c = await evo(`/instance/create`, {
        method: "POST",
        body: JSON.stringify({
          instanceName: INSTANCE,
          integration: "WHATSAPP-BAILEYS",
          qrcode: true,
          groupsIgnore: true,
          alwaysOnline: false,
          readMessages: false,
          ...(WEBHOOK ? { webhook: webhookConfig() } : {}),
        }),
      });
      if (!c.ok) return NextResponse.json({ error: "Falha ao criar a instância", detail: c.body }, { status: 502 });
      const qr = c.body?.qrcode?.base64;
      if (qr) return NextResponse.json({ qr, pairingCode: c.body?.qrcode?.pairingCode ?? null });
    } else if (s.state === "open") {
      return NextResponse.json({ connected: true });
    }
    const q = await evo(`/instance/connect/${INSTANCE}`);
    if (!q.ok) return NextResponse.json({ error: "Falha ao gerar o QR Code", detail: q.body }, { status: 502 });
    return NextResponse.json({ qr: q.body?.base64 ?? null, pairingCode: q.body?.pairingCode ?? null });
  }

  if (action === "logout") {
    const r = await evo(`/instance/logout/${INSTANCE}`, { method: "DELETE" });
    return NextResponse.json({ ok: r.ok, detail: r.ok ? null : r.body }, { status: r.ok ? 200 : 502 });
  }

  if (action === "webhook") {
    if (!WEBHOOK) return NextResponse.json({ error: "N8N_WEBHOOK_URL não configurada." }, { status: 500 });
    const r = await evo(`/webhook/set/${INSTANCE}`, { method: "POST", body: JSON.stringify({ webhook: webhookConfig() }) });
    return NextResponse.json({ ok: r.ok, detail: r.ok ? null : r.body }, { status: r.ok ? 200 : 502 });
  }

  return NextResponse.json({ error: "ação inválida" }, { status: 400 });
}
