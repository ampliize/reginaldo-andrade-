import type { Stage } from "./supabase";

export const STAGES: { key: Stage; label: string; color: string }[] = [
  { key: "novo", label: "Novo", color: "var(--c-gray)" },
  { key: "em_atendimento", label: "Em atendimento", color: "var(--c-blue)" },
  { key: "qualificado", label: "Qualificado", color: "var(--c-violet)" },
  { key: "agendado", label: "Reunião agendada", color: "var(--c-green)" },
  { key: "reuniao_realizada", label: "Reunião realizada", color: "var(--c-teal)" },
  { key: "no_show", label: "Não compareceu", color: "var(--c-amber)" },
  { key: "desqualificado", label: "Desqualificado", color: "var(--c-slate)" },
  { key: "perdido", label: "Perdido", color: "var(--c-red)" },
];
export const stageLabel = (s: string | null | undefined) => STAGES.find((x) => x.key === s)?.label ?? s ?? "—";
export const stageColor = (s: string | null | undefined) => STAGES.find((x) => x.key === s)?.color ?? "var(--c-gray)";

const DICT: Record<string, string> = {
  comercio: "Comércio", servicos: "Serviços", industria: "Indústria", outro: "Outro",
  perfil_comportamental: "Perfil comportamental", manual_cultura: "Manual de cultura",
  processo_seletivo: "Processo seletivo", treinamento: "Treinamento",
  indicacao: "Indicação", evento: "Evento", instagram: "Instagram", anuncio: "Anúncio", whatsapp: "WhatsApp",
  alta: "Alta", media: "Média", baixa: "Baixa",
  nao_sabe_responder: "IA não soube responder", pediu_humano: "Pediu atendente",
  assunto_especifico: "Assunto específico da empresa", pergunta_preco: "Insistiu em preço",
  cliente_atual: "Cliente atual", reclamacao: "Reclamação", fora_de_contexto: "Fora de contexto",
  cancelamento: "Cancelamento", perguntou_se_e_robo: "Perguntou se é robô", erro_agenda: "Erro na agenda",
  menos_de_5: "Menos de 5 colaboradores", pessoa_fisica: "Pessoa física", fornecedor: "Fornecedor",
  spam: "Spam", fora_do_segmento: "Fora do segmento", sem_resposta: "Sem resposta",
  nao_informado: "Não informado", desconhecida: "Desconhecida",
  criado: "Primeiro contato", etapa: "Mudou de etapa", ia_pausada: "IA pausada (transbordo)",
  ia_retomada: "Devolvido para a IA", followup: "Follow-up enviado",
  reuniao_agendada: "Reunião agendada", reuniao_remarcada: "Reunião remarcada",
  reuniao_cancelada: "Reunião cancelada", lembrete_reuniao: "Lembrete de reunião enviado", erro: "Erro técnico", reuniao_realizada: "Reunião realizada", reuniao_no_show: "Não compareceu",
};
export const label = (k: string | null | undefined) => (k ? DICT[k] ?? k : "—");

export const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
export const fmtDuration = (sec: number | null | undefined) => {
  if (sec == null) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} h`;
  return `${(sec / 86400).toFixed(1)} dias`;
};
export const fmtPhone = (p: string) => {
  const d = p.replace(/\D/g, "").replace(/^55/, "");
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : p;
};
export const displayName = (l: { name: string | null; whatsapp_name: string | null; phone: string }) =>
  l.name || l.whatsapp_name || fmtPhone(l.phone);
