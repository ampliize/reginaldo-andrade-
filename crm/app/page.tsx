"use client";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Shell from "@/components/Shell";
import { supabase } from "@/lib/supabase";
import { fmtDuration, label } from "@/lib/labels";

type Metrics = {
  leads: number; em_atendimento: number; qualificados: number; desqualificados: number; agendados: number;
  reunioes_realizadas: number; no_show: number; perdidos: number;
  taxa_qualificacao: number | null; taxa_agendamento: number | null; taxa_agend_qualif: number | null;
  tempo_1a_resposta_seg: number | null; tempo_ate_agendar_h: number | null;
  msgs_recebidas: number; msgs_enviadas_ia: number; msgs_enviadas_equipe: number;
  transbordos: number; transbordos_abertos: number; followups: number;
  por_origem: Record<string, number>; por_servico: Record<string, number>; por_segmento: Record<string, number>;
  motivos_transbordo: Record<string, number>; motivos_desqualificacao: Record<string, number>;
  por_dia: { dia: string; leads: number; agendados: number }[];
  por_hora: { hora: number; msgs: number }[];
};

const PERIODS = [
  { k: 7, l: "7 dias" }, { k: 30, l: "30 dias" }, { k: 90, l: "90 dias" }, { k: 3650, l: "Tudo" },
];

export default function Dashboard() {
  return <Shell><DashboardInner /></Shell>;
}

function DashboardInner() {
  const [days, setDays] = useState(30);
  const [m, setM] = useState<Metrics | null>(null);

  useEffect(() => {
    const load = () => {
      const to = new Date(Date.now() + 60_000);
      const from = new Date(Date.now() - days * 86400_000);
      supabase.rpc("crm_metrics", { p_from: from.toISOString(), p_to: to.toISOString() })
        .then(({ data }) => setM(data as Metrics));
    };
    load();
    const ch = supabase.channel("dash")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [days]);

  const funnel = useMemo(() => m ? [
    { l: "Leads recebidos", v: m.leads },
    { l: "Qualificados", v: m.qualificados },
    { l: "Reunião agendada", v: m.agendados },
    { l: "Reunião realizada", v: m.reunioes_realizadas },
  ] : [], [m]);

  const hours = useMemo(() => {
    const map = new Map((m?.por_hora ?? []).map((h) => [h.hora, h.msgs]));
    return Array.from({ length: 24 }, (_, h) => ({ hora: `${h}h`, msgs: map.get(h) ?? 0 }));
  }, [m]);

  return (
    <>
      <div className="page-head">
        <h1>Painel</h1>
        <div className="seg">
          {PERIODS.map((p) => (
            <button key={p.k} className={days === p.k ? "on" : ""} onClick={() => setDays(p.k)}>{p.l}</button>
          ))}
        </div>
      </div>

      {!m ? <div className="muted">Carregando métricas…</div> : (
        <div className="grid" style={{ gap: 20 }}>
          <div className="grid kpis">
            <Kpi l="Leads recebidos" v={m.leads} />
            <Kpi l="Qualificados" v={m.qualificados} s={`${m.taxa_qualificacao ?? 0}% dos leads`} />
            <Kpi l="Reuniões agendadas" v={m.agendados} s={`${m.taxa_agendamento ?? 0}% dos leads · ${m.taxa_agend_qualif ?? 0}% dos qualificados`} />
            <Kpi l="Reuniões realizadas" v={m.reunioes_realizadas} s={`${m.no_show} não compareceram`} />
            <Kpi l="Tempo da 1ª resposta" v={fmtDuration(m.tempo_1a_resposta_seg)} s="média" />
            <Kpi l="Tempo até agendar" v={m.tempo_ate_agendar_h != null ? `${m.tempo_ate_agendar_h} h` : "—"} s="média, do 1º contato" />
            <Kpi l="Em atendimento" v={m.em_atendimento} s="conversas abertas" />
            <Kpi l="Transbordos" v={m.transbordos} s={`${m.transbordos_abertos} aguardando equipe`} />
            <Kpi l="Mensagens" v={m.msgs_recebidas + m.msgs_enviadas_ia + m.msgs_enviadas_equipe}
                 s={`${m.msgs_recebidas} recebidas · ${m.msgs_enviadas_ia} IA · ${m.msgs_enviadas_equipe} equipe`} />
            <Kpi l="Follow-ups" v={m.followups} s={`${m.perdidos} perdidos sem resposta`} />
            <Kpi l="Desqualificados" v={m.desqualificados} />
          </div>

          <div className="grid three">
            <div className="card">
              <h3>Funil de atendimento</h3>
              {funnel.map((f, i) => {
                const max = funnel[0].v || 1;
                const prev = i > 0 ? funnel[i - 1].v : null;
                return (
                  <div key={f.l} className="funnel-row">
                    <span>{f.l}</span>
                    <div className="bar-bg"><div className="bar" style={{ width: `${(f.v / max) * 100}%`, opacity: 1 - i * 0.15 }} /></div>
                    <span style={{ textAlign: "right" }}>
                      <b>{f.v}</b>{prev ? <span className="muted"> · {Math.round((f.v / prev) * 100)}%</span> : null}
                    </span>
                  </div>
                );
              })}
            </div>
            <Breakdown title="Motivos de transbordo" data={m.motivos_transbordo} />
          </div>

          <div className="card">
            <h3>Leads e agendamentos por dia</h3>
            <div style={{ height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={m.por_dia.map((d) => ({ ...d, dia: new Date(d.dia + "T12:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="dia" stroke="var(--muted)" fontSize={12} />
                  <YAxis allowDecimals={false} stroke="var(--muted)" fontSize={12} />
                  <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)" }} />
                  <Legend />
                  <Bar dataKey="leads" name="Leads" fill="var(--c-blue)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="agendados" name="Agendados" fill="var(--c-green)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid two">
            <div className="card">
              <h3>Horário das mensagens recebidas</h3>
              <div style={{ height: 220 }}>
                <ResponsiveContainer>
                  <BarChart data={hours}>
                    <XAxis dataKey="hora" stroke="var(--muted)" fontSize={11} interval={2} />
                    <YAxis allowDecimals={false} stroke="var(--muted)" fontSize={11} />
                    <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)" }} />
                    <Bar dataKey="msgs" name="Mensagens" fill="var(--c-violet)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <Breakdown title="Serviço de interesse" data={m.por_servico} />
          </div>

          <div className="grid two">
            <Breakdown title="Origem dos leads" data={m.por_origem} />
            <Breakdown title="Segmento" data={m.por_segmento} />
          </div>
          <Breakdown title="Motivos de desqualificação" data={m.motivos_desqualificacao} />
        </div>
      )}
    </>
  );
}

function Kpi({ l, v, s }: { l: string; v: number | string; s?: string }) {
  return (
    <div className="card kpi">
      <div className="l">{l}</div>
      <div className="v">{v}</div>
      {s && <div className="s">{s}</div>}
    </div>
  );
}

function Breakdown({ title, data }: { title: string; data: Record<string, number> }) {
  const rows = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="card">
      <h3>{title}</h3>
      {rows.length === 0 ? <div className="muted">Sem dados no período.</div> : rows.map(([k, v]) => (
        <div key={k} className="funnel-row">
          <span>{label(k)}</span>
          <div className="bar-bg"><div className="bar" style={{ width: `${(v / max) * 100}%`, height: 14 }} /></div>
          <span style={{ textAlign: "right" }}><b>{v}</b></span>
        </div>
      ))}
    </div>
  );
}
