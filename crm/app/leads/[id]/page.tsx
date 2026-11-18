"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, MessageCircle, MessagesSquare } from "lucide-react";
import Shell from "@/components/Shell";
import { AiStrip, Composer, Messages } from "@/components/Chat";
import { Avatar, StageBadge, timeAgo } from "@/components/ui";
import { supabase, type Handoff, type Lead, type LeadEvent, type Meeting, type Message, type Stage } from "@/lib/supabase";
import { STAGES, displayName, fmtDateTime, fmtDuration, fmtPhone, label, stageLabel } from "@/lib/labels";
import { markSeen } from "@/lib/api";

export default function LeadPage() {
  return <Shell><LeadInner /></Shell>;
}

const yesNo = (v: boolean | null) => (v == null ? "—" : v ? "Sim" : "Não");

function LeadInner() {
  const { id } = useParams<{ id: string }>();
  const [lead, setLead] = useState<Lead | null>(null);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    const [l, m, e, h, mt] = await Promise.all([
      supabase.from("leads").select("*").eq("id", id).single(),
      supabase.from("messages").select("*").eq("lead_id", id).order("created_at"),
      supabase.from("lead_events").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
      supabase.from("handoffs").select("*").eq("lead_id", id).eq("status", "aberto").maybeSingle(),
      supabase.from("meetings").select("*").eq("lead_id", id).order("start_at", { ascending: false }),
    ]);
    setLead(l.data as Lead);
    setNotes((l.data as Lead)?.notes ?? "");
    setMsgs((m.data as Message[]) ?? []);
    setEvents((e.data as LeadEvent[]) ?? []);
    setHandoff((h.data as Handoff) ?? null);
    setMeetings((mt.data as Meeting[]) ?? []);
  }, [id]);

  useEffect(() => {
    load(); markSeen(id);
    const ch = supabase.channel(`lead-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `lead_id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter: `id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "handoffs", filter: `lead_id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "meetings", filter: `lead_id=eq.${id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, load]);

  async function changeStage(stage: Stage) {
    await supabase.from("leads").update({ stage }).eq("id", id);
    load();
  }

  if (!lead) return <div className="muted">Carregando…</div>;

  const firstResp = lead.first_message_at && lead.first_response_at
    ? (new Date(lead.first_response_at).getTime() - new Date(lead.first_message_at).getTime()) / 1000 : null;

  return (
    <>
      <Link href="/pipeline" className="muted row" style={{ marginBottom: 12, fontSize: 13 }}><ArrowLeft size={14} />Pipeline</Link>
      <div className="page-head">
        <div className="row" style={{ gap: 14 }}>
          <Avatar name={displayName(lead)} />
          <div>
            <h1>{displayName(lead)}</h1>
            <p>{fmtPhone(lead.phone)}{lead.company ? ` · ${lead.company}` : ""}{lead.role ? ` · ${lead.role}` : ""}</p>
          </div>
        </div>
        <div className="toolbar">
          <StageBadge stage={lead.stage} />
          <select value={lead.stage} onChange={(e) => changeStage(e.target.value as Stage)}>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <Link className="btn" href={`/conversas?lead=${lead.id}`}><MessagesSquare size={15} /><span className="hide-sm">Abrir em </span>Conversas</Link>
          <a className="btn" href={`https://wa.me/${lead.phone}`} target="_blank" rel="noreferrer"><MessageCircle size={15} />WhatsApp</a>
        </div>
      </div>

      <div className="grid three">
        <div className="card p0 chat-card">
          <AiStrip lead={lead} reason={handoff?.reason} onChange={load} />
          {handoff?.summary && lead.ai_paused && <div style={{ padding: "8px 16px", fontSize: 13, borderBottom: "1px solid var(--border)" }}><b>Resumo do Pedro:</b> {handoff.summary}</div>}
          <div style={{ background: "var(--panel-2)", flex: 1, minHeight: 0, display: "flex" }}><Messages msgs={msgs} /></div>
          <Composer lead={lead} onSent={load} />
        </div>

        <div className="grid" style={{ alignContent: "start" }}>
          <div className="card">
            <h3>Qualificação {lead.qualification_score != null && <span className="badge brand">{lead.qualification_score}/100</span>}</h3>
            <dl className="fields">
              <dt>Nome</dt><dd>{lead.name ?? "—"}</dd>
              <dt>E-mail</dt><dd>{lead.email ?? "—"}</dd>
              <dt>Empresa</dt><dd>{lead.company ?? "—"}</dd>
              <dt>Segmento</dt><dd>{label(lead.segment)}</dd>
              <dt>Colaboradores</dt><dd>{lead.employees ?? "—"}</dd>
              <dt>Cidade</dt><dd>{lead.city ?? "—"}</dd>
              <dt>Desafio</dt><dd>{lead.challenge ?? "—"}</dd>
              <dt>Satisfação c/ equipe</dt><dd>{lead.team_satisfaction ?? "—"}</dd>
              <dt>Tem normas</dt><dd>{yesNo(lead.has_norms)}</dd>
              <dt>Processo de RH</dt><dd>{yesNo(lead.has_people_process)}</dd>
              <dt>É o decisor</dt><dd>{yesNo(lead.is_decision_maker)}</dd>
              <dt>Urgência</dt><dd>{label(lead.urgency)}</dd>
              <dt>Interesse</dt><dd>{label(lead.service_interest)}</dd>
              <dt>Origem</dt><dd>{label(lead.source)}</dd>
              {lead.disqualify_reason && <><dt>Desqualificado</dt><dd>{label(lead.disqualify_reason)}</dd></>}
              {lead.lost_reason && <><dt>Perdido</dt><dd>{label(lead.lost_reason)}</dd></>}
            </dl>
          </div>

          <div className="card">
            <h3>Reunião</h3>
            {meetings.length === 0 ? <div className="muted">Nenhuma reunião agendada.</div> : meetings.map((mt) => (
              <div key={mt.id} className="row" style={{ marginBottom: 8, alignItems: "flex-start" }}>
                <CalendarDays size={16} color="var(--brand)" style={{ marginTop: 2 }} />
                <div>
                  <b>{new Date(mt.start_at).toLocaleString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</b>
                  <div className="row" style={{ marginTop: 4 }}><span className="badge">{label("reuniao_" + mt.status)}</span>{mt.meet_url && <a href={mt.meet_url} target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>Google Meet</a>}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <h3>Indicadores</h3>
            <dl className="fields">
              <dt>1º contato</dt><dd>{fmtDateTime(lead.first_message_at)}</dd>
              <dt>1ª resposta em</dt><dd>{fmtDuration(firstResp)}</dd>
              <dt>Qualificado em</dt><dd>{fmtDateTime(lead.qualified_at)}</dd>
              <dt>Agendado em</dt><dd>{fmtDateTime(lead.scheduled_at)}</dd>
              <dt>Na etapa há</dt><dd>{timeAgo(lead.stage_changed_at)}</dd>
              <dt>Mensagens</dt><dd>{msgs.filter((m) => m.direction === "in").length} recebidas · {msgs.filter((m) => m.sender === "ia").length} IA · {msgs.filter((m) => m.sender === "equipe").length} equipe</dd>
              <dt>Follow-ups</dt><dd>{lead.followup_count}</dd>
            </dl>
          </div>

          <div className="card">
            <h3>Jornada</h3>
            <ul className="timeline">
              {events.map((e) => (
                <li key={e.id}>
                  <div>{e.type === "etapa" ? <>{stageLabel(e.from_stage)} → <b>{stageLabel(e.to_stage)}</b></> : <b>{label(e.type)}</b>}
                    {e.type === "ia_pausada" && e.data?.reason ? <span className="muted"> · {label(String(e.data.reason))}</span> : null}
                    {e.actor === "equipe" && <span className="muted"> · pela equipe</span>}
                  </div>
                  <div className="when">{fmtDateTime(e.created_at)}</div>
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h3>Anotações da equipe</h3>
            <textarea rows={4} style={{ width: "100%" }} value={notes} onChange={(e) => setNotes(e.target.value)}
              onBlur={() => supabase.from("leads").update({ notes }).eq("id", id)} placeholder="Anotações internas (salvam ao sair do campo)" />
          </div>
        </div>
      </div>
    </>
  );
}
