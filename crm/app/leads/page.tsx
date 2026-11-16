"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { supabase, type Lead } from "@/lib/supabase";
import { STAGES, displayName, fmtDateTime, fmtPhone, label, stageColor, stageLabel } from "@/lib/labels";

export default function LeadsPage() {
  return <Shell><LeadsInner /></Shell>;
}

function LeadsInner() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [view, setView] = useState<"kanban" | "lista">("kanban");
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");

  useEffect(() => {
    const load = () => supabase.from("leads").select("*").order("updated_at", { ascending: false }).limit(1000)
      .then(({ data }) => setLeads((data as Lead[]) ?? []));
    load();
    const ch = supabase.channel("leads-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return leads.filter((l) =>
      (!stage || l.stage === stage) &&
      (!t || [l.name, l.whatsapp_name, l.company, l.phone, l.email].some((v) => v?.toLowerCase().includes(t))));
  }, [leads, q, stage]);

  return (
    <>
      <div className="page-head">
        <h1>Leads <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>{filtered.length}</span></h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input placeholder="Buscar nome, empresa, telefone…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />
          {view === "lista" && (
            <select value={stage} onChange={(e) => setStage(e.target.value)}>
              <option value="">Todas as etapas</option>
              {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          )}
          <div className="seg">
            <button className={view === "kanban" ? "on" : ""} onClick={() => setView("kanban")}>Funil</button>
            <button className={view === "lista" ? "on" : ""} onClick={() => setView("lista")}>Lista</button>
          </div>
        </div>
      </div>

      {view === "kanban" ? (
        <div className="kanban">
          {STAGES.map((s) => {
            const items = filtered.filter((l) => l.stage === s.key);
            return (
              <div className="col" key={s.key}>
                <div className="col-head">
                  <span><span className="dot" style={{ background: s.color, marginRight: 6 }} />{s.label}</span>
                  <span className="muted">{items.length}</span>
                </div>
                {items.map((l) => (
                  <Link key={l.id} href={`/leads/${l.id}`} className="lead-card">
                    <div className="t">{displayName(l)}</div>
                    <div className="m">{l.company ?? "Empresa não informada"}{l.employees ? ` · ${l.employees} colab.` : ""}</div>
                    <div className="m" style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {l.ai_paused && <span className="badge warn">Aguardando equipe</span>}
                      {l.service_interest && <span className="badge">{label(l.service_interest)}</span>}
                      <span>{fmtDateTime(l.last_inbound_at ?? l.created_at)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr><th>Lead</th><th>Empresa</th><th>Colab.</th><th>Segmento</th><th>Etapa</th><th>Atendimento</th><th>Última msg</th><th>Entrou em</th></tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr key={l.id} className="click" onClick={() => router.push(`/leads/${l.id}`)}>
                  <td><b>{displayName(l)}</b><div className="muted">{fmtPhone(l.phone)}</div></td>
                  <td>{l.company ?? "—"}</td>
                  <td>{l.employees ?? "—"}</td>
                  <td>{label(l.segment)}</td>
                  <td><span className="badge"><span className="dot" style={{ background: stageColor(l.stage) }} />{stageLabel(l.stage)}</span></td>
                  <td>{l.ai_paused ? <span className="badge warn">Equipe</span> : <span className="badge">IA</span>}</td>
                  <td>{fmtDateTime(l.last_inbound_at)}</td>
                  <td>{fmtDateTime(l.created_at)}</td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={8} className="muted">Nenhum lead encontrado.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
