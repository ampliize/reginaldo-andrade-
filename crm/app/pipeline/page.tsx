"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Building2, Clock, Hand, Search, Users } from "lucide-react";
import Shell from "@/components/Shell";
import { Avatar, timeAgo } from "@/components/ui";
import { supabase, type Lead, type Stage } from "@/lib/supabase";
import { STAGES, displayName, label } from "@/lib/labels";

type Inbox = { id: string; ultima_msg: string | null; ultima_de: string | null; nao_lida: boolean };

const ATIVAS: Stage[] = ["novo", "em_atendimento", "qualificado", "agendado", "reuniao_realizada"];
const ENCERRADAS: Stage[] = ["no_show", "desqualificado", "perdido"];

export default function PipelinePage() {
  return <Shell><Pipeline /></Shell>;
}

function scoreColor(s: number) {
  return s >= 70 ? { background: "var(--ok-soft)", color: "var(--ok)" } : s >= 40 ? { background: "var(--warn-soft)", color: "var(--warn)" } : { background: "var(--panel-3)", color: "var(--muted)" };
}

function Pipeline() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [inbox, setInbox] = useState<Record<string, Inbox>>({});
  const [q, setQ] = useState("");
  const [quem, setQuem] = useState<"todos" | "ia" | "equipe">("todos");
  const [interesse, setInteresse] = useState("");
  const [encerrados, setEncerrados] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);

  const load = useCallback(async () => {
    const [l, i] = await Promise.all([
      supabase.from("leads").select("*").order("updated_at", { ascending: false }).limit(1000),
      supabase.rpc("crm_inbox", { p_filtro: "todas", p_busca: null }),
    ]);
    setLeads((l.data as Lead[]) ?? []);
    setInbox(Object.fromEntries(((i.data as Inbox[]) ?? []).map((x) => [x.id, x])));
  }, []);

  useEffect(() => {
    load();
    const ch = supabase.channel("pipeline")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, load)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return leads.filter((l) =>
      (!t || [l.name, l.whatsapp_name, l.company, l.phone].some((v) => v?.toLowerCase().includes(t))) &&
      (quem === "todos" || (quem === "equipe" ? l.ai_paused : !l.ai_paused)) &&
      (!interesse || l.service_interest === interesse));
  }, [leads, q, quem, interesse]);

  const cols = encerrados ? [...ATIVAS, ...ENCERRADAS] : ATIVAS;
  const total = filtered.length || 1;

  async function move(id: string, stage: Stage) {
    const lead = leads.find((l) => l.id === id);
    if (!lead || lead.stage === stage) return;
    const patch: Partial<Lead> = { stage };
    if (stage === "perdido") {
      const r = window.prompt("Motivo da perda (ex.: sem interesse, sem orçamento, sem resposta):", "");
      if (r === null) return;
      patch.lost_reason = r || "outro";
    }
    if (stage === "desqualificado") {
      const r = window.prompt("Motivo da desqualificação (ex.: menos de 5 colaboradores, pessoa física):", "");
      if (r === null) return;
      patch.disqualify_reason = r || "outro";
    }
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch, stage_changed_at: new Date().toISOString() } : l)));
    await supabase.from("leads").update(patch).eq("id", id);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pipeline</h1>
          <p>Arraste os cards entre as etapas. O Pedro move os leads sozinho até o agendamento.</p>
        </div>
        <div className="toolbar">
          <div className="search"><Search size={16} /><input placeholder="Buscar lead ou empresa" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select value={interesse} onChange={(e) => setInteresse(e.target.value)}>
            <option value="">Todos os serviços</option>
            <option value="perfil_comportamental">Perfil comportamental</option>
            <option value="manual_cultura">Manual de cultura</option>
            <option value="processo_seletivo">Processo seletivo</option>
            <option value="treinamento">Treinamento</option>
          </select>
          <div className="seg">
            <button className={quem === "todos" ? "on" : ""} onClick={() => setQuem("todos")}>Todos</button>
            <button className={quem === "ia" ? "on" : ""} onClick={() => setQuem("ia")}>Com a IA</button>
            <button className={quem === "equipe" ? "on" : ""} onClick={() => setQuem("equipe")}>Com a equipe</button>
          </div>
          <button className="btn" onClick={() => setEncerrados((v) => !v)}>{encerrados ? "Ocultar encerrados" : "Mostrar encerrados"}</button>
        </div>
      </div>

      <div className="pipeline">
        {cols.map((key) => {
          const st = STAGES.find((s) => s.key === key)!;
          const items = filtered.filter((l) => l.stage === key);
          return (
            <div
              key={key}
              className={`stage-col ${over === key ? "over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setOver(key); }}
              onDragLeave={() => setOver((o) => (o === key ? null : o))}
              onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/plain"); if (id) move(id, key); }}
            >
              <div className="stage-head">
                <div className="t"><span className="dot" style={{ background: st.color }} />{st.label}<span className="n">{items.length}</span></div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{Math.round((items.length / total) * 100)}% dos leads</div>
                <div className="stage-bar" style={{ background: st.color, opacity: .7 }} />
              </div>
              <div className="stage-body">
                {items.length === 0 && <div className="muted" style={{ fontSize: 12, textAlign: "center", padding: 16 }}>Solte um card aqui</div>}
                {items.map((l) => {
                  const ib = inbox[l.id];
                  return (
                    <Link
                      key={l.id}
                      href={`/leads/${l.id}`}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", l.id); setDrag(l.id); }}
                      onDragEnd={() => setDrag(null)}
                      className={`deal ${drag === l.id ? "dragging" : ""}`}
                    >
                      <div className="h">
                        <Avatar name={displayName(l)} size="sm" />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="name">{displayName(l)}</div>
                          <div className="co">{l.company ?? "Empresa não informada"}</div>
                        </div>
                        {l.qualification_score != null && <span className="score" style={scoreColor(l.qualification_score)}>{l.qualification_score}</span>}
                      </div>
                      {ib?.ultima_msg && <div className="snip">{ib.ultima_de === "lead" ? "" : ib.ultima_de === "ia" ? "Pedro: " : "Equipe: "}{ib.ultima_msg}</div>}
                      <div className="f">
                        {l.ai_paused ? <span className="badge amber"><Hand size={11} />Equipe</span> : <span className="badge brand"><Bot size={11} />IA</span>}
                        {l.employees != null && <span className="badge"><Users size={11} />{l.employees}</span>}
                        {l.service_interest && <span className="badge"><Building2 size={11} />{label(l.service_interest)}</span>}
                        {ib?.nao_lida && <span className="badge ok">nova msg</span>}
                        <span className="sp"><Clock size={11} />{timeAgo(l.stage_changed_at)}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
