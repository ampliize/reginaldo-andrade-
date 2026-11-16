"use client";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Bot, CalendarCheck, CalendarDays, CheckCircle2, Clock, LifeBuoy, MessageCircle, Timer, UserPlus, Zap } from "lucide-react";
import Shell from "@/components/Shell";
import { Avatar, Delta, Empty, Kpi, timeAgo } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { STAGES, fmtDuration, label } from "@/lib/labels";

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
};
type Heat = { dow: number; hora: number; total: number };
type Attn = { id: string; nome: string; detalhe: string; quando: string | null; tipo: "transbordo" | "nao_lida" | "reuniao" };

const PERIODS = [{ k: 1, l: "Hoje" }, { k: 7, l: "7 dias" }, { k: 30, l: "30 dias" }, { k: 90, l: "90 dias" }];
const COLORS = ["#0d9488", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#14b8a6", "#ec4899", "#64748b"];
const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export default function Dashboard() {
  return <Shell><DashboardInner /></Shell>;
}

function range(days: number, offset = 0) {
  const end = new Date();
  if (days === 1) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - offset); const e = new Date(start); e.setDate(e.getDate() + 1);
    return { from: start, to: offset ? e : new Date(end.getTime() + 60_000) };
  }
  const to = new Date(end.getTime() - offset * days * 86400_000 + 60_000);
  return { from: new Date(to.getTime() - days * 86400_000), to };
}

function DashboardInner() {
  const [days, setDays] = useState(30);
  const [m, setM] = useState<Metrics | null>(null);
  const [prev, setPrev] = useState<Metrics | null>(null);
  const [heat, setHeat] = useState<Heat[]>([]);
  const [stages, setStages] = useState<Record<string, number>>({});
  const [attn, setAttn] = useState<Attn[]>([]);

  useEffect(() => {
    const load = async () => {
      const cur = range(days), old = range(days, 1);
      const [a, b, h, st, ho, nl, mt] = await Promise.all([
        supabase.rpc("crm_metrics", { p_from: cur.from.toISOString(), p_to: cur.to.toISOString() }),
        supabase.rpc("crm_metrics", { p_from: old.from.toISOString(), p_to: old.to.toISOString() }),
        supabase.rpc("crm_heatmap", { p_from: cur.from.toISOString(), p_to: cur.to.toISOString() }),
        supabase.from("leads").select("stage"),
        supabase.from("handoffs").select("lead_id, reason, opened_at, leads(name, whatsapp_name, phone)").eq("status", "aberto").order("opened_at").limit(8),
        supabase.rpc("crm_inbox", { p_filtro: "nao_lidas", p_busca: null }),
        supabase.from("meetings").select("lead_id, start_at, leads(name, whatsapp_name, phone)").in("status", ["agendada", "remarcada"]).gte("start_at", new Date().toISOString()).order("start_at").limit(5),
      ]);
      setM(a.data as Metrics); setPrev(b.data as Metrics); setHeat((h.data as Heat[]) ?? []);
      const counts: Record<string, number> = {};
      for (const r of (st.data as { stage: string }[]) ?? []) counts[r.stage] = (counts[r.stage] ?? 0) + 1;
      setStages(counts);
      type LeadRef = { name: string | null; whatsapp_name: string | null; phone: string };
      const nm = (l: LeadRef | null) => l?.name || l?.whatsapp_name || l?.phone || "Lead";
      const list: Attn[] = [
        ...((ho.data as unknown as { lead_id: string; reason: string; opened_at: string; leads: LeadRef }[]) ?? []).map((x) => ({ id: x.lead_id, nome: nm(x.leads), detalhe: label(x.reason), quando: x.opened_at, tipo: "transbordo" as const })),
        ...((nl.data as { id: string; nome: string; ultima_msg: string; ultima_em: string; ai_paused: boolean }[]) ?? []).filter((x) => x.ai_paused).slice(0, 5).map((x) => ({ id: x.id, nome: x.nome, detalhe: x.ultima_msg, quando: x.ultima_em, tipo: "nao_lida" as const })),
        ...((mt.data as unknown as { lead_id: string; start_at: string; leads: LeadRef }[]) ?? []).map((x) => ({ id: x.lead_id, nome: nm(x.leads), detalhe: new Date(x.start_at).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }), quando: null, tipo: "reuniao" as const })),
      ];
      setAttn(list);
    };
    load();
    const ch = supabase.channel("dash")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "handoffs" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [days]);

  const funnel = useMemo(() => m ? [
    { l: "Leads recebidos", v: m.leads, c: "#3b82f6" },
    { l: "Qualificados", v: m.qualificados, c: "#8b5cf6" },
    { l: "Reunião agendada", v: m.agendados, c: "#0d9488" },
    { l: "Reunião realizada", v: m.reunioes_realizadas, c: "#16a34a" },
  ] : [], [m]);

  const heatMax = Math.max(1, ...heat.map((h) => Number(h.total)));
  const automacao = m && m.msgs_enviadas_ia + m.msgs_enviadas_equipe > 0 ? Math.round((m.msgs_enviadas_ia / (m.msgs_enviadas_ia + m.msgs_enviadas_equipe)) * 100) : null;
  const origem = m ? Object.entries(m.por_origem).map(([k, v]) => ({ name: label(k), value: v })) : [];
  const totalAtivos = STAGES.reduce((s, x) => s + (stages[x.key] ?? 0), 0) || 1;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Painel comercial</h1>
          <p>Desempenho do Pedro e da equipe, do primeiro contato até a reunião.</p>
        </div>
        <div className="seg">{PERIODS.map((p) => <button key={p.k} className={days === p.k ? "on" : ""} onClick={() => setDays(p.k)}>{p.l}</button>)}</div>
      </div>

      {!m ? <div className="muted">Carregando indicadores…</div> : (
        <div className="grid" style={{ gap: 18 }}>
          <div className="grid kpis">
            <Kpi icon={<UserPlus size={17} />} label="Leads recebidos" value={m.leads} delta={<Delta cur={m.leads} prev={prev?.leads} />} sub="vs período anterior" />
            <Kpi icon={<CheckCircle2 size={17} />} label="Qualificados" value={m.qualificados} delta={<Delta cur={m.qualificados} prev={prev?.qualificados} />} sub={`${m.taxa_qualificacao ?? 0}% dos leads`} />
            <Kpi icon={<CalendarCheck size={17} />} label="Reuniões agendadas" value={m.agendados} delta={<Delta cur={m.agendados} prev={prev?.agendados} />} sub={`${m.taxa_agend_qualif ?? 0}% dos qualificados`} />
            <Kpi icon={<CalendarDays size={17} />} label="Reuniões realizadas" value={m.reunioes_realizadas} delta={<Delta cur={m.reunioes_realizadas} prev={prev?.reunioes_realizadas} />} sub={`${m.no_show} não compareceram`} />
            <Kpi icon={<Timer size={17} />} label="1ª resposta (média)" value={fmtDuration(m.tempo_1a_resposta_seg)} delta={<Delta cur={m.tempo_1a_resposta_seg} prev={prev?.tempo_1a_resposta_seg} invert />} sub="do contato à resposta" />
            <Kpi icon={<Clock size={17} />} label="Tempo até agendar" value={m.tempo_ate_agendar_h != null ? `${m.tempo_ate_agendar_h} h` : "—"} delta={<Delta cur={m.tempo_ate_agendar_h} prev={prev?.tempo_ate_agendar_h} invert />} sub="média" />
          </div>

          <div className="grid three">
            <div className="card">
              <h3>Funil de conversão <small>no período</small></h3>
              <div className="funnel">
                {funnel.map((f, i) => {
                  const max = funnel[0].v || 1;
                  const prevStep = i > 0 ? funnel[i - 1].v : null;
                  return (
                    <div key={f.l} className="funnel-row">
                      <span className="lbl">{f.l}</span>
                      <div className="bar-bg"><div className="bar" style={{ width: `${Math.max((f.v / max) * 100, f.v ? 6 : 0)}%`, background: f.c }}>{f.v || ""}</div></div>
                      <span className="pct">{prevStep ? <><b>{Math.round((f.v / prevStep) * 100)}%</b> da etapa</> : <b>{f.v}</b>}</span>
                    </div>
                  );
                })}
              </div>
              <div className="row wrap" style={{ marginTop: 16, gap: 18 }}>
                <span className="muted">Conversão total: <b style={{ color: "var(--text)" }}>{m.taxa_agendamento ?? 0}%</b> dos leads viram reunião</span>
                <span className="muted">Desqualificados: <b style={{ color: "var(--text)" }}>{m.desqualificados}</b></span>
                <span className="muted">Perdidos: <b style={{ color: "var(--text)" }}>{m.perdidos}</b></span>
              </div>
            </div>

            <div className="card">
              <h3>Precisa de atenção <Link href="/conversas" className="muted" style={{ fontSize: 12 }}>ver conversas</Link></h3>
              {attn.length === 0 ? <Empty icon={<CheckCircle2 size={26} color="var(--ok)" />} title="Tudo em dia">Nenhum lead esperando a equipe.</Empty> : (
                <div className="attn">
                  {attn.map((a, i) => (
                    <Link key={i} href={a.tipo === "reuniao" ? `/leads/${a.id}` : `/conversas?lead=${a.id}`}>
                      <Avatar name={a.nome} size="sm" />
                      <div className="t"><b>{a.nome}</b><span>{a.detalhe}</span></div>
                      {a.tipo === "transbordo" && <span className="badge warn"><LifeBuoy size={11} />{timeAgo(a.quando)}</span>}
                      {a.tipo === "nao_lida" && <span className="badge amber"><MessageCircle size={11} />nova</span>}
                      {a.tipo === "reuniao" && <span className="badge ok"><CalendarDays size={11} />reunião</span>}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid three">
            <div className="card">
              <h3>Leads e agendamentos por dia</h3>
              <div style={{ height: 260 }}>
                <ResponsiveContainer>
                  <AreaChart data={m.por_dia.map((d) => ({ ...d, dia: new Date(d.dia + "T12:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) }))}>
                    <defs>
                      <linearGradient id="gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity={.35} /><stop offset="100%" stopColor="#3b82f6" stopOpacity={0} /></linearGradient>
                      <linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0d9488" stopOpacity={.4} /><stop offset="100%" stopColor="#0d9488" stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="dia" stroke="var(--muted)" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} stroke="var(--muted)" fontSize={12} tickLine={false} axisLine={false} width={28} />
                    <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10 }} />
                    <Legend iconType="circle" />
                    <Area type="monotone" dataKey="leads" name="Leads" stroke="#3b82f6" strokeWidth={2} fill="url(#gl)" />
                    <Area type="monotone" dataKey="agendados" name="Agendados" stroke="#0d9488" strokeWidth={2} fill="url(#ga)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="card">
              <h3>Origem dos leads</h3>
              {origem.length === 0 ? <Empty icon={<UserPlus size={24} />} title="Sem dados no período" /> : (
                <div style={{ height: 260 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={origem} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2}>
                        {origem.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10 }} />
                      <Legend iconType="circle" />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <div className="grid three">
            <div className="card">
              <h3>Quando os leads chamam <small>mensagens recebidas por dia e hora</small></h3>
              <div className="heat">
                <span />{Array.from({ length: 24 }, (_, h) => <span key={h} style={{ textAlign: "center" }}>{h % 3 === 0 ? h : ""}</span>)}
                {DOW.map((d, di) => (
                  <Fragment key={d}>
                    <span className="lbl">{d}</span>
                    {Array.from({ length: 24 }, (_, h) => {
                      const v = Number(heat.find((x) => x.dow === di && x.hora === h)?.total ?? 0);
                      return <span key={`${di}-${h}`} className="c" title={`${d} ${h}h: ${v} mensagens`} style={v ? { background: `rgba(13,148,136,${0.15 + (v / heatMax) * 0.85})` } : undefined} />;
                    })}
                  </Fragment>
                ))}
              </div>
            </div>
            <div className="card">
              <h3>Atendimento automático</h3>
              <div className="row" style={{ alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 34, fontWeight: 700 }}>{automacao != null ? `${automacao}%` : "—"}</span>
                <span className="muted">das mensagens enviadas pelo Pedro</span>
              </div>
              <div style={{ marginTop: 14 }}>
                <HBar l="Mensagens do Pedro" v={m.msgs_enviadas_ia} max={Math.max(m.msgs_enviadas_ia, m.msgs_enviadas_equipe, 1)} c="#0d9488" icon={<Bot size={13} />} />
                <HBar l="Mensagens da equipe" v={m.msgs_enviadas_equipe} max={Math.max(m.msgs_enviadas_ia, m.msgs_enviadas_equipe, 1)} c="#6366f1" />
                <HBar l="Transbordos para a equipe" v={m.transbordos} max={Math.max(m.leads, 1)} c="#f59e0b" icon={<LifeBuoy size={13} />} />
                <HBar l="Follow-ups automáticos" v={m.followups} max={Math.max(m.leads, m.followups, 1)} c="#3b82f6" icon={<Zap size={13} />} />
              </div>
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            <div className="card">
              <h3>Pipeline agora <Link href="/pipeline" className="muted" style={{ fontSize: 12 }}>abrir</Link></h3>
              {STAGES.map((s) => <HBar key={s.key} l={s.label} v={stages[s.key] ?? 0} max={totalAtivos} c={s.color} />)}
            </div>
            <Breakdown title="Serviço de interesse" data={m.por_servico} />
            <Breakdown title="Motivos de transbordo" data={m.motivos_transbordo} color="#f59e0b" />
            <Breakdown title="Segmento" data={m.por_segmento} color="#8b5cf6" />
            <Breakdown title="Motivos de desqualificação" data={m.motivos_desqualificacao} color="#64748b" />
          </div>
        </div>
      )}
    </>
  );
}

function HBar({ l, v, max, c, icon }: { l: string; v: number; max: number; c: string; icon?: React.ReactNode }) {
  return (
    <div className="hbar">
      <span className="row" style={{ gap: 6, fontSize: 13 }}>{icon}{l}</span><b>{v}</b>
      <div className="track"><div className="fill" style={{ width: `${(v / (max || 1)) * 100}%`, background: c }} /></div>
    </div>
  );
}

function Breakdown({ title, data, color = "#0d9488" }: { title: string; data: Record<string, number>; color?: string }) {
  const rows = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="card">
      <h3>{title}</h3>
      {rows.length === 0 ? <div className="muted">Sem dados no período.</div> : rows.map(([k, v]) => <HBar key={k} l={label(k)} v={v} max={max} c={color} />)}
    </div>
  );
}
