"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { supabase, type Handoff, type Lead } from "@/lib/supabase";
import { displayName, fmtDateTime, fmtDuration, label } from "@/lib/labels";

type Row = Handoff & { leads: Pick<Lead, "id" | "name" | "whatsapp_name" | "phone" | "company"> };

export default function HandoffsPage() {
  return <Shell><Inner /></Shell>;
}

function Inner() {
  const [rows, setRows] = useState<Row[]>([]);
  const [tab, setTab] = useState<"aberto" | "devolvido">("aberto");

  const load = () =>
    supabase.from("handoffs").select("*, leads(id,name,whatsapp_name,phone,company)")
      .eq("status", tab).order("opened_at", { ascending: tab === "aberto" }).limit(300)
      .then(({ data }) => setRows((data as Row[]) ?? []));

  useEffect(() => {
    load();
    const ch = supabase.channel("handoffs-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "handoffs" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function giveBack(leadId: string) {
    const { data } = await supabase.auth.getUser();
    await supabase.rpc("sdr_return_to_ai", { p_lead_id: leadId, p_by: data.user?.email ?? "equipe" });
    load();
  }

  return (
    <>
      <div className="page-head">
        <h1>Transbordos</h1>
        <div className="seg">
          <button className={tab === "aberto" ? "on" : ""} onClick={() => setTab("aberto")}>Aguardando equipe</button>
          <button className={tab === "devolvido" ? "on" : ""} onClick={() => setTab("devolvido")}>Devolvidos</button>
        </div>
      </div>
      <p className="muted intro">
        Quando a IA não sabe responder ou o lead precisa de uma pessoa, o atendimento automático é pausado e o lead aparece aqui.
        Responda pela tela de Conversas (ou pelo WhatsApp) e clique em “Devolver para a IA” para o Pedro continuar.
      </p>
      <div className="card p0 table-wrap">
        <table className="stack">
          <thead><tr><th>Lead</th><th>Motivo</th><th>Resumo para a equipe</th><th>{tab === "aberto" ? "Esperando há" : "Devolvido"}</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-label="Lead"><Link href={`/leads/${r.lead_id}`}><b>{displayName(r.leads)}</b></Link><div className="muted">{r.leads.company ?? ""}</div></td>
                <td data-label="Motivo"><span className="badge warn">{label(r.reason)}</span></td>
                <td data-label="Resumo" style={{ maxWidth: 420 }}>{r.summary ?? "—"}</td>
                <td data-label={tab === "aberto" ? "Esperando há" : "Devolvido"}>{tab === "aberto" ? fmtDuration((Date.now() - new Date(r.opened_at).getTime()) / 1000) : <>{fmtDateTime(r.returned_at)}<div className="muted">{r.returned_by}</div></>}</td>
                <td className="actions" style={{ whiteSpace: "nowrap" }}>{tab === "aberto" && <><Link className="btn sm" href={`/conversas?lead=${r.lead_id}`}>Responder</Link>{" "}<button className="btn sm primary" onClick={() => giveBack(r.lead_id)}>Devolver para a IA</button></>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="muted">{tab === "aberto" ? "Nenhum lead aguardando a equipe." : "Nenhum transbordo devolvido."}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
