import { createClient } from "@supabase/supabase-js";

// URL e chave publicável são públicas por natureza (a segurança vem do login + RLS).
// Ficam no código para o deploy na Vercel não precisar de variáveis de ambiente.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hnxqeccyasyyajtwlbal.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_3ubG_t5v3GhDUsCcfI3Kfw_4z-NeWCG";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export type Stage =
  | "novo" | "em_atendimento" | "qualificado" | "desqualificado"
  | "agendado" | "reuniao_realizada" | "no_show" | "perdido";

export type Lead = {
  id: string; phone: string; whatsapp_name: string | null; name: string | null; email: string | null;
  company: string | null; role: string | null; segment: string | null; employees: number | null;
  city: string | null; challenge: string | null; team_satisfaction: string | null;
  has_norms: boolean | null; has_people_process: boolean | null; is_decision_maker: boolean | null;
  urgency: string | null; service_interest: string | null; source: string | null; stage: Stage;
  qualification_score: number | null; disqualify_reason: string | null; lost_reason: string | null;
  ai_paused: boolean; ai_paused_reason: string | null; ai_paused_at: string | null;
  followup_count: number; first_message_at: string | null; first_response_at: string | null;
  last_inbound_at: string | null; last_outbound_at: string | null; qualified_at: string | null;
  scheduled_at: string | null; notes: string | null; created_at: string; updated_at: string;
};

export type Message = {
  id: string; lead_id: string; direction: "in" | "out"; sender: "lead" | "ia" | "equipe" | "sistema";
  type: string; content: string | null; created_at: string;
};

export type LeadEvent = {
  id: string; lead_id: string; type: string; from_stage: Stage | null; to_stage: Stage | null;
  actor: string; data: Record<string, unknown>; created_at: string;
};

export type Handoff = {
  id: string; lead_id: string; reason: string; summary: string | null; status: "aberto" | "devolvido";
  opened_at: string; returned_at: string | null; returned_by: string | null;
};

export type Meeting = {
  id: string; lead_id: string; calcom_booking_uid: string | null; start_at: string; end_at: string | null;
  meet_url: string | null; status: string; created_at: string;
};
