"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { ArrowLeft, Bot, ExternalLink, Hand, MessagesSquare, Search } from "lucide-react";
import Shell from "@/components/Shell";
import { AiStrip, Composer, Messages } from "@/components/Chat";
import { Avatar, Empty, StageBadge, timeAgo } from "@/components/ui";
import { supabase, type Handoff, type Lead, type Meeting, type Message } from "@/lib/supabase";
import { displayName, fmtDateTime, fmtPhone, label } from "@/lib/labels";
import { markSeen } from "@/lib/api";

type Row = {
  id: string; phone: string; nome: string; company: string | null; stage: string; ai_paused: boolean;
  ultima_msg: string | null; ultima_de: string | null; ultima_em: string; nao_lida: boolean; handoff_motivo: string | null;
};

const FILTROS = [
  { k: "todas", l: "Todas" },
  { k: "nao_lidas", l: "Não lidas" },
  { k: "equipe", l: "Com a equipe" },
  { k: "ia", l: "Com a IA" },
];

export default function ConversasPage() {
  return <Shell flush><Suspense fallback={null}><Inbox /></Suspense></Shell>;
}

function Inbox() {
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get("lead");
  const [filtro, setFiltro] = useState("todas");
  const [busca, setBusca] = useState("");
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("crm_inbox", { p_filtro: filtro, p_busca: busca || null });
    setRows((data as Row[]) ?? []);
  }, [filtro, busca]);

  useEffect(() => {
    load();
    const ch = supabase.channel("inbox-list")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, load)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "leads" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  useEffect(() => {
    if (!selected && !params.get("lista") && rows.length && typeof window !== "undefined" && window.innerWidth > 900) router.replace(`/conversas?lead=${rows[0].id}`);
  }, [selected, rows, router, params]);

  return (
    <div className={`inbox ${selected ? "has-sel" : ""}`}>
      <div className="inbox-list">
        <div className="head">
          <h1>Conversas</h1>
          <div className="search"><Search size={16} /><input style={{ width: "100%" }} placeholder="Buscar nome, empresa ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
          <div className="seg" style={{ alignSelf: "flex-start" }}>
            {FILTROS.map((f) => <button key={f.k} className={filtro === f.k ? "on" : ""} onClick={() => setFiltro(f.k)}>{f.l}</button>)}
          </div>
        </div>
        <div className="inbox-items">
          {rows.length === 0 && <Empty icon={<MessagesSquare size={28} />} title="Nenhuma conversa">As conversas do WhatsApp aparecem aqui.</Empty>}
          {rows.map((r) => (
            <div key={r.id} className={`conv ${selected === r.id ? "on" : ""}`} onClick={() => router.replace(`/conversas?lead=${r.id}`)}>
              <Avatar name={r.nome} />
              <div className="body">
                <div className="l1"><b>{r.nome}</b>{r.ai_paused ? <Hand size={13} color="var(--warn)" /> : <Bot size={13} color="var(--brand)" />}<time>{timeAgo(r.ultima_em)}</time></div>
                <div className="l2">
                  <span className="txt">{r.ultima_de === "ia" ? "Pedro: " : r.ultima_de === "equipe" ? "Você: " : ""}{r.ultima_msg ?? ""}</span>
                  {r.nao_lida && <span className="unread" />}
                </div>
                {r.handoff_motivo && <div style={{ marginTop: 4 }}><span className="badge warn">{label(r.handoff_motivo)}</span></div>}
              </div>
            </div>
          ))}
        </div>
      </div>
      {selected ? <Thread key={selected} id={selected} onBack={() => router.replace("/conversas?lista=1")} /> : (
        <div className="thread"><Empty icon={<MessagesSquare size={32} />} title="Selecione uma conversa">Escolha um lead à esquerda para ver e responder a conversa.</Empty></div>
      )}
    </div>
  );
}

function Thread({ id, onBack }: { id: string; onBack: () => void }) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [meeting, setMeeting] = useState<Meeting | null>(null);

  const load = useCallback(async () => {
    const [l, m, h, mt] = await Promise.all([
      supabase.from("leads").select("*").eq("id", id).single(),
      supabase.from("messages").select("*").eq("lead_id", id).order("created_at"),
      supabase.from("handoffs").select("*").eq("lead_id", id).eq("status", "aberto").maybeSingle(),
      supabase.from("meetings").select("*").eq("lead_id", id).in("status", ["agendada", "remarcada"]).order("start_at").limit(1).maybeSingle(),
    ]);
    setLead(l.data as Lead); setMsgs((m.data as Message[]) ?? []); setHandoff((h.data as Handoff) ?? null); setMeeting((mt.data as Meeting) ?? null);
  }, [id]);

  useEffect(() => {
    load(); markSeen(id);
    const ch = supabase.channel(`thread-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `lead_id=eq.${id}` }, () => { load(); markSeen(id); })
      .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter: `id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "handoffs", filter: `lead_id=eq.${id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, load]);

  if (!lead) return <div className="thread" />;

  return (
    <>
      <div className="thread">
        <div className="thread-head">
          <button className="btn ghost sm back-btn" aria-label="Voltar" onClick={onBack}><ArrowLeft size={18} /></button>
          <Avatar name={displayName(lead)} />
          <div className="who"><b>{displayName(lead)}</b><span>{fmtPhone(lead.phone)}{lead.company ? ` · ${lead.company}` : ""}</span></div>
          <StageBadge stage={lead.stage} />
          <Link className="btn sm" href={`/leads/${lead.id}`}><ExternalLink size={14} /><span className="hide-sm">Ficha</span></Link>
        </div>
        <AiStrip lead={lead} reason={handoff?.reason} onChange={load} />
        {handoff?.summary && lead.ai_paused && <div style={{ padding: "8px 16px", fontSize: 13, background: "var(--panel)", borderBottom: "1px solid var(--border)" }}><b>Resumo do Pedro:</b> {handoff.summary}</div>}
        <Messages msgs={msgs} />
        <Composer lead={lead} onSent={load} />
      </div>
      <aside className="side">
        <h4>Qualificação</h4>
        <dl className="fields">
          <dt>Empresa</dt><dd>{lead.company ?? "—"}</dd>
          <dt>Cargo</dt><dd>{lead.role ?? "—"}</dd>
          <dt>Segmento</dt><dd>{label(lead.segment)}</dd>
          <dt>Colaboradores</dt><dd>{lead.employees ?? "—"}</dd>
          <dt>Desafio</dt><dd>{lead.challenge ?? "—"}</dd>
          <dt>Decisor</dt><dd>{lead.is_decision_maker == null ? "—" : lead.is_decision_maker ? "Sim" : "Não"}</dd>
          <dt>Urgência</dt><dd>{label(lead.urgency)}</dd>
          <dt>Interesse</dt><dd>{label(lead.service_interest)}</dd>
          <dt>Nota</dt><dd>{lead.qualification_score != null ? `${lead.qualification_score}/100` : "—"}</dd>
        </dl>
        <h4>Reunião</h4>
        {meeting ? (
          <div>
            <b>{new Date(meeting.start_at).toLocaleString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</b>
            {meeting.meet_url && <div><a href={meeting.meet_url} target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>Abrir Google Meet</a></div>}
          </div>
        ) : <div className="muted">Nenhuma reunião agendada.</div>}
        <h4>Atendimento</h4>
        <dl className="fields">
          <dt>1º contato</dt><dd>{fmtDateTime(lead.first_message_at)}</dd>
          <dt>Na etapa há</dt><dd>{timeAgo(lead.stage_changed_at)}</dd>
          <dt>Follow-ups</dt><dd>{lead.followup_count}</dd>
          <dt>Origem</dt><dd>{label(lead.source)}</dd>
        </dl>
      </aside>
    </>
  );
}
