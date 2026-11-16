"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { supabase, type Lead, type Meeting } from "@/lib/supabase";
import { displayName, label } from "@/lib/labels";

type Row = Meeting & { leads: Pick<Lead, "id" | "name" | "whatsapp_name" | "phone" | "company" | "employees" | "challenge"> };

export default function AgendaPage() {
  return <Shell><Inner /></Shell>;
}

function Inner() {
  const [rows, setRows] = useState<Row[]>([]);
  const [tab, setTab] = useState<"proximas" | "passadas">("proximas");

  const load = () => {
    const now = new Date().toISOString();
    let q = supabase.from("meetings").select("*, leads(id,name,whatsapp_name,phone,company,employees,challenge)");
    q = tab === "proximas" ? q.gte("start_at", now).order("start_at") : q.lt("start_at", now).order("start_at", { ascending: false });
    q.limit(200).then(({ data }) => setRows((data as Row[]) ?? []));
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("agenda").on("postgres_changes", { event: "*", schema: "public", table: "meetings" }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function setStatus(m: Row, status: "realizada" | "no_show") {
    await supabase.from("meetings").update({ status }).eq("id", m.id);
    await supabase.from("leads").update({ stage: status === "realizada" ? "reuniao_realizada" : "no_show" }).eq("id", m.lead_id);
    await supabase.from("lead_events").insert({ lead_id: m.lead_id, type: "reuniao_" + status, actor: "equipe" });
    load();
  }

  return (
    <>
      <div className="page-head">
        <h1>Agenda de diagnósticos</h1>
        <div className="seg">
          <button className={tab === "proximas" ? "on" : ""} onClick={() => setTab("proximas")}>Próximas</button>
          <button className={tab === "passadas" ? "on" : ""} onClick={() => setTab("passadas")}>Passadas</button>
        </div>
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Quando</th><th>Lead</th><th>Empresa</th><th>Desafio</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td><b>{new Date(m.start_at).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</b>
                  {m.meet_url && <div><a href={m.meet_url} target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>Google Meet</a></div>}</td>
                <td><Link href={`/leads/${m.lead_id}`}><b>{displayName(m.leads)}</b></Link></td>
                <td>{m.leads.company ?? "—"}{m.leads.employees ? <div className="muted">{m.leads.employees} colaboradores</div> : null}</td>
                <td style={{ maxWidth: 320 }}>{m.leads.challenge ?? "—"}</td>
                <td><span className="badge">{label("reuniao_" + m.status)}</span></td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {tab === "passadas" && (m.status === "agendada" || m.status === "remarcada") && (
                    <>
                      <button className="btn" onClick={() => setStatus(m, "realizada")}>Realizada</button>{" "}
                      <button className="btn danger" onClick={() => setStatus(m, "no_show")}>Não compareceu</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="muted">Nenhuma reunião.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
