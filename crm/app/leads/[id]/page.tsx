"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { supabase, type Handoff, type Lead, type LeadEvent, type Meeting, type Message, type Stage } from "@/lib/supabase";
import { STAGES, displayName, fmtDateTime, fmtDuration, fmtPhone, label, stageColor, stageLabel } from "@/lib/labels";

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
  const [busy, setBusy] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [l, m, e, h, mt] = await Promise.all([
      supabase.from("leads").select("*").eq("id", id).single(),
      supabase.from("messages").select("*").eq("lead_id", id).order("created_at"),
      supabase.from("lead_events").select("*").eq("lead_id", id).order("created_at"),
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
    load();
    const ch = supabase.channel(`lead-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `lead_id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter: `id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "handoffs", filter: `lead_id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "meetings", filter: `lead_id=eq.${id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, load]);

  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight }); }, [msgs.length]);

  async function userEmail() {
    const { data } = await supabase.auth.getUser();
    return data.user?.email ?? "equipe";
  }

  async function returnToAi() {
    setBusy(true);
    await supabase.rpc("sdr_return_to_ai", { p_lead_id: id, p_by: await userEmail() });
    setBusy(false); load();
  }

  async function takeOver() {
    setBusy(true);
    await supabase.rpc("sdr_handoff", { p_lead_id: id, p_reason: "pediu_humano", p_summary: `Atendimento assumido manualmente por ${await userEmail()}` });
    setBusy(false); load();
  }

  async function changeStage(stage: Stage) {
    await supabase.from("leads").update({ stage }).eq("id", id);
    load();
  }

  async function saveNotes() {
    await supabase.from("leads").update({ notes }).eq("id", id);
  }

  if (!lead) return <div className="muted">Carregando…</div>;

  const firstResp = lead.first_message_at && lead.first_response_at
    ? (new Date(lead.first_response_at).getTime() - new Date(lead.first_message_at).getTime()) / 1000 : null;

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/leads" className="muted">← Leads</Link>
          <h1 style={{ marginTop: 6 }}>{displayName(lead)}</h1>
          <div className="muted">{fmtPhone(lead.phone)}{lead.company ? ` · ${lead.company}` : ""}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="badge"><span className="dot" style={{ background: stageColor(lead.stage) }} />{stageLabel(lead.stage)}</span>
          <select value={lead.stage} onChange={(e) => changeStage(e.target.value as Stage)}>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          {!lead.ai_paused && <button className="btn" disabled={busy} onClick={takeOver}>Assumir atendimento</button>}
          <a className="btn" href={`https://wa.me/${lead.phone}`} target="_blank" rel="noreferrer">Abrir no WhatsApp</a>
        </div>
      </div>

      {lead.ai_paused && (
        <div className="alert">
          <div>
            <b>IA pausada — aguardando a equipe.</b> Motivo: {label(handoff?.reason ?? lead.ai_paused_reason)}
            {handoff?.summary && <div style={{ color: "var(--text)", marginTop: 4 }}>{handoff.summary}</div>}
            <div className="muted" style={{ fontSize: 12 }}>Desde {fmtDateTime(lead.ai_paused_at)}. Responda pelo WhatsApp e devolva para a IA quando terminar.</div>
          </div>
          <button className="btn primary" disabled={busy} onClick={returnToAi}>Devolver para a IA</button>
        </div>
      )}

      <div className="grid three">
        <div className="card">
          <h3>Conversa</h3>
          <div className="chat" ref={chatRef}>
            {msgs.length === 0 && <div className="muted">Sem mensagens.</div>}
            {msgs.map((m) => (
              <div key={m.id} className={`bubble ${m.direction} ${m.sender}`}>
                {m.type === "audio" && <div className="muted" style={{ fontSize: 12 }}>🎤 Áudio (transcrição)</div>}
                {m.content ?? `[${m.type}]`}
                <div className="meta">{m.sender === "ia" ? "Pedro (IA)" : m.sender === "equipe" ? "Equipe" : m.sender === "lead" ? "Lead" : "Sistema"} · {fmtDateTime(m.created_at)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid" style={{ alignContent: "start" }}>
          <div className="card">
            <h3>Qualificação {lead.qualification_score != null && <span className="badge" style={{ marginLeft: 6 }}>{lead.qualification_score}/100</span>}</h3>
            <dl className="fields">
              <dt>Nome</dt><dd>{lead.name ?? "—"}</dd>
              <dt>Cargo</dt><dd>{lead.role ?? "—"}</dd>
              <dt>Empresa</dt><dd>{lead.company ?? "—"}</dd>
              <dt>Segmento</dt><dd>{label(lead.segment)}</dd>
              <dt>Colaboradores</dt><dd>{lead.employees ?? "—"}</dd>
              <dt>Cidade</dt><dd>{lead.city ?? "—"}</dd>
              <dt>E-mail</dt><dd>{lead.email ?? "—"}</dd>
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
              <div key={mt.id} style={{ marginBottom: 8 }}>
                <b>{new Date(mt.start_at).toLocaleString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</b>
                <div><span className="badge">{label("reuniao_" + mt.status)}</span> {mt.meet_url && <a href={mt.meet_url} target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>Google Meet</a>}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <h3>Indicadores do atendimento</h3>
            <dl className="fields">
              <dt>1º contato</dt><dd>{fmtDateTime(lead.first_message_at)}</dd>
              <dt>1ª resposta em</dt><dd>{fmtDuration(firstResp)}</dd>
              <dt>Qualificado em</dt><dd>{fmtDateTime(lead.qualified_at)}</dd>
              <dt>Agendado em</dt><dd>{fmtDateTime(lead.scheduled_at)}</dd>
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
                  </div>
                  <div className="when">{fmtDateTime(e.created_at)}</div>
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h3>Anotações da equipe</h3>
            <textarea rows={4} style={{ width: "100%" }} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} placeholder="Anotações internas (salva ao sair do campo)" />
          </div>
        </div>
      </div>
    </>
  );
}
