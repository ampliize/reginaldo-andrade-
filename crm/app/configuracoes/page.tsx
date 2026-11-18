"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { supabase } from "@/lib/supabase";
import { fmtPhone } from "@/lib/labels";

type Status = {
  instance?: string; webhook?: string | null; exists?: boolean;
  state?: "open" | "close" | "connecting" | "nao_criada" | "erro"; number?: string | null; profileName?: string | null;
  error?: string;
};

// O CRM não guarda nenhuma chave secreta: ele chama um webhook do n8n (URL salva em config_bot),
// e o n8n fala com a Evolution usando a credencial dele. O n8n valida o login pelo token do Supabase.
async function api(method: "GET" | "POST", body?: object) {
  const [{ data: sess }, { data: cfg }] = await Promise.all([
    supabase.auth.getSession(),
    supabase.from("config_bot").select("valor").eq("chave", "n8n_webhook_whatsapp_url").maybeSingle(),
  ]);
  const url = (cfg?.valor as string) || "";
  if (!url) return { error: "Webhook do n8n ainda não configurado (n8n_webhook_whatsapp_url)." };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
      body: JSON.stringify(method === "GET" ? { action: "status" } : body),
    });
    if (res.status === 401) return { error: "Sessão inválida. Saia e entre de novo." };
    return await res.json();
  } catch {
    return { error: "Não foi possível falar com o n8n. Verifique se o workflow de conexão está ativo." };
  }
}

export default function ConfigPage() {
  return <Shell><Inner /></Shell>;
}

function Inner() {
  const [st, setSt] = useState<Status | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [pairing, setPairing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const qrTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const s: Status = await api("GET");
    setSt(s);
    if (s.state === "open") {
      setQr(null); setPairing(null);
      if (qrTimer.current) { clearInterval(qrTimer.current); qrTimer.current = null; }
    }
    return s;
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // enquanto o QR estiver na tela, verifica a conexão a cada 3 s
  useEffect(() => {
    if (!qr) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [qr, refresh]);

  useEffect(() => () => { if (qrTimer.current) clearInterval(qrTimer.current); }, []);

  async function genQr() {
    setBusy(true); setMsg("");
    const r = await api("POST", { action: "connect" });
    setBusy(false);
    if (r.error) { setMsg(r.error); return; }
    if (r.connected) { refresh(); return; }
    setQr(r.qr); setPairing(r.pairingCode);
    // o QR do WhatsApp expira em ~40 s: gera outro a cada 30 s
    if (qrTimer.current) clearInterval(qrTimer.current);
    qrTimer.current = setInterval(async () => {
      const n = await api("POST", { action: "connect" });
      if (n.connected) { refresh(); return; }
      if (n.qr) { setQr(n.qr); setPairing(n.pairingCode); }
    }, 30000);
    refresh();
  }

  async function logout() {
    if (!confirm("Desconectar o WhatsApp? O agente para de atender até conectar de novo.")) return;
    setBusy(true);
    await api("POST", { action: "logout" });
    setBusy(false); setQr(null); refresh();
  }

  async function fixWebhook() {
    setBusy(true);
    const r = await api("POST", { action: "webhook" });
    setBusy(false);
    setMsg(r.ok ? "Webhook do agente configurado." : r.error ?? "Não foi possível configurar o webhook.");
  }

  const connected = st?.state === "open";

  return (
    <>
      <div className="page-head"><h1>Configurações</h1></div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3>WhatsApp do atendimento</h3>
          {!st ? <div className="muted">Verificando conexão…</div> : st.error ? (
            <div style={{ color: "var(--danger)" }}>{st.error}</div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span className="dot" style={{ background: connected ? "var(--c-green)" : st.state === "connecting" ? "var(--c-amber)" : "var(--c-red)", width: 10, height: 10 }} />
                <b>{connected ? "Conectado" : st.state === "connecting" ? "Aguardando leitura do QR Code" : "Desconectado"}</b>
              </div>

              {connected ? (
                <>
                  <dl className="fields" style={{ marginBottom: 16 }}>
                    <dt>Número</dt><dd>{st.number ? fmtPhone(st.number) : "—"}</dd>
                    <dt>Perfil</dt><dd>{st.profileName ?? "—"}</dd>
                    <dt>Instância</dt><dd>{st.instance}</dd>
                  </dl>
                  <p className="muted">O Pedro está recebendo e respondendo as mensagens deste número.</p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="btn" disabled={busy} onClick={fixWebhook}>Reconfigurar webhook do agente</button>
                    <button className="btn danger" disabled={busy} onClick={logout}>Desconectar</button>
                  </div>
                </>
              ) : qr ? (
                <div style={{ textAlign: "center" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`} alt="QR Code do WhatsApp"
                       style={{ width: 260, height: 260, background: "#fff", padding: 8, borderRadius: 12 }} />
                  <ol style={{ textAlign: "left", maxWidth: 360, margin: "12px auto" }}>
                    <li>Abra o WhatsApp no celular do número de atendimento.</li>
                    <li>Toque em <b>Configurações → Aparelhos conectados → Conectar aparelho</b>.</li>
                    <li>Aponte a câmera para este QR Code.</li>
                  </ol>
                  {pairing && <p className="muted">Ou use o código de pareamento: <b>{pairing}</b></p>}
                  <p className="muted" style={{ fontSize: 12 }}>O QR Code é renovado automaticamente a cada 30 segundos.</p>
                </div>
              ) : (
                <>
                  <p className="muted">Conecte o WhatsApp que o Pedro vai usar para atender os leads.</p>
                  <button className="btn primary" disabled={busy} onClick={genQr}>{busy ? "Gerando…" : "Gerar QR Code"}</button>
                </>
              )}
            </>
          )}
          {msg && <p style={{ marginTop: 12 }}>{msg}</p>}
        </div>

        <div className="card">
          <h3>Como funciona</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Depois de conectado, toda mensagem que chegar neste WhatsApp vai para o agente Pedro, que atende, qualifica e agenda a reunião de diagnóstico.
          </p>
          <p className="muted">
            Se a equipe responder um lead pelo celular, o Pedro pausa automaticamente naquela conversa. Para ele voltar, use “Devolver para a IA” na ficha do lead ou em Transbordos.
          </p>
          <p className="muted">Mantenha o celular com internet. Se o WhatsApp desconectar, gere um novo QR Code aqui.</p>
        </div>
      </div>
      <ConfigEditor />
    </>
  );
}

type Cfg = { chave: string; valor: unknown; descricao: string | null };

function ConfigEditor() {
  const [rows, setRows] = useState<Cfg[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState("");

  const load = useCallback(() => {
    supabase.from("config_bot").select("chave,valor,descricao").order("chave").then(({ data }) => {
      const r = (data as Cfg[]) ?? [];
      setRows(r);
      setDraft(Object.fromEntries(r.map((x) => [x.chave, typeof x.valor === "string" ? x.valor : JSON.stringify(x.valor)])));
    });
  }, []);
  useEffect(load, [load]);

  async function save(c: Cfg) {
    const raw = draft[c.chave];
    let valor: unknown = raw;
    if (typeof c.valor !== "string") {
      try { valor = JSON.parse(raw); } catch { setSaved(`Valor inválido em ${c.chave}`); return; }
    }
    const { error } = await supabase.from("config_bot").update({ valor }).eq("chave", c.chave);
    setSaved(error ? `Erro ao salvar ${c.chave}` : `${c.chave} salvo.`);
    load();
  }

  return (
    <div className="card">
      <h3>Parâmetros do agente</h3>
      <div className="table-wrap">
        <table className="stack plain">
          <thead><tr><th>Parâmetro</th><th>Valor</th><th></th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.chave}>
                <td style={{ maxWidth: 320 }}><b>{c.chave}</b><div className="muted" style={{ fontSize: 12 }}>{c.descricao}</div></td>
                <td className="full" style={{ minWidth: 260 }}>
                  <input style={{ width: "100%" }} value={draft[c.chave] ?? ""} onChange={(e) => setDraft({ ...draft, [c.chave]: e.target.value })} />
                </td>
                <td className="actions"><button className="btn" onClick={() => save(c)}>Salvar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {saved && <p className="muted">{saved}</p>}
    </div>
  );
}
