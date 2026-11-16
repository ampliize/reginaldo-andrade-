-- CRM + agente SDR (Pedro) — consultoria Reginaldo
-- Jornada: novo -> em_atendimento -> qualificado -> agendado -> reuniao_realizada
--          (desqualificado / perdido / no_show em qualquer ponto)

create type lead_stage as enum (
  'novo', 'em_atendimento', 'qualificado', 'desqualificado',
  'agendado', 'reuniao_realizada', 'no_show', 'perdido'
);
create type msg_direction as enum ('in', 'out');
create type msg_sender as enum ('lead', 'ia', 'equipe', 'sistema');
create type meeting_status as enum ('agendada', 'remarcada', 'cancelada', 'realizada', 'no_show');
create type handoff_status as enum ('aberto', 'devolvido');

-- ---------------------------------------------------------------- leads
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,               -- 5579999999999 (remoteJid sem @s.whatsapp.net)
  whatsapp_name text,
  name text,
  email text,
  company text,
  role text,                                 -- cargo
  segment text,                              -- comercio | servicos | industria | outro
  employees int,                             -- nº de funcionários
  city text,
  challenge text,                            -- principal desafio relatado
  team_satisfaction text,                    -- satisfação com a equipe (roteiro Q17)
  has_norms boolean,                         -- já tem normas/estrutura normativa
  has_people_process boolean,                -- já tem processo de gestão de pessoas
  is_decision_maker boolean,
  urgency text,                              -- alta | media | baixa
  service_interest text,                     -- perfil_comportamental | manual_cultura | processo_seletivo | treinamento
  source text default 'whatsapp',            -- indicacao | evento | instagram | anuncio | whatsapp
  stage lead_stage not null default 'novo',
  qualification_score int,                   -- 0..100
  disqualify_reason text,
  lost_reason text,
  ai_paused boolean not null default false,  -- true = IA não responde até a equipe devolver
  ai_paused_reason text,
  ai_paused_at timestamptz,
  followup_count int not null default 0,
  next_followup_at timestamptz,
  first_message_at timestamptz,
  first_response_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  qualified_at timestamptz,
  scheduled_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_stage_idx on public.leads(stage);
create index leads_created_idx on public.leads(created_at);
create index leads_followup_idx on public.leads(next_followup_at) where next_followup_at is not null;

-- ---------------------------------------------------------------- mensagens
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  direction msg_direction not null,
  sender msg_sender not null,
  type text not null default 'text',         -- text | audio | image | document | sticker
  content text,                              -- texto ou transcrição do áudio
  wa_message_id text unique,                 -- id da Evolution API (evita duplicidade)
  created_at timestamptz not null default now()
);
create index messages_lead_idx on public.messages(lead_id, created_at);

-- ---------------------------------------------------------------- jornada (eventos)
create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  type text not null,        -- criado | etapa | ia_pausada | ia_retomada | reuniao_agendada | followup | ...
  from_stage lead_stage,
  to_stage lead_stage,
  actor msg_sender not null default 'sistema',
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index lead_events_lead_idx on public.lead_events(lead_id, created_at);
create index lead_events_type_idx on public.lead_events(type, created_at);

-- ---------------------------------------------------------------- transbordos para a equipe
create table public.handoffs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  reason text not null,      -- nao_sabe_responder | pediu_humano | fora_de_contexto | pergunta_preco | reclamacao | perguntou_se_e_robo | erro
  summary text,
  status handoff_status not null default 'aberto',
  opened_at timestamptz not null default now(),
  returned_at timestamptz,
  returned_by text
);
create index handoffs_open_idx on public.handoffs(status, opened_at);
create index handoffs_lead_idx on public.handoffs(lead_id);

-- ---------------------------------------------------------------- reuniões (cal.com)
create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  calcom_booking_uid text unique,
  start_at timestamptz not null,
  end_at timestamptz,
  meet_url text,
  status meeting_status not null default 'agendada',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index meetings_start_idx on public.meetings(start_at);
create index meetings_lead_idx on public.meetings(lead_id);

-- ================================================================ triggers

create or replace function public.tg_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

create trigger leads_touch before update on public.leads
  for each row execute function public.tg_touch_updated_at();
create trigger meetings_touch before update on public.meetings
  for each row execute function public.tg_touch_updated_at();

-- registra criação e toda mudança de etapa na jornada
create or replace function public.tg_lead_journey() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.lead_events(lead_id, type, to_stage, data)
    values (new.id, 'criado', new.stage, jsonb_build_object('source', new.source));
  elsif new.stage is distinct from old.stage then
    insert into public.lead_events(lead_id, type, from_stage, to_stage)
    values (new.id, 'etapa', old.stage, new.stage);
    if new.stage = 'qualificado' and new.qualified_at is null then new.qualified_at = now(); end if;
    if new.stage = 'agendado' and new.scheduled_at is null then new.scheduled_at = now(); end if;
  end if;
  if tg_op = 'UPDATE' and new.ai_paused is distinct from old.ai_paused then
    insert into public.lead_events(lead_id, type, data)
    values (new.id, case when new.ai_paused then 'ia_pausada' else 'ia_retomada' end,
            jsonb_build_object('reason', coalesce(new.ai_paused_reason, old.ai_paused_reason)));
  end if;
  return new;
end $$;

create trigger leads_journey_ins after insert on public.leads
  for each row execute function public.tg_lead_journey();
create trigger leads_journey_upd before update on public.leads
  for each row execute function public.tg_lead_journey();

-- atualiza timestamps de atendimento a cada mensagem
create or replace function public.tg_message_stats() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.direction = 'in' then
    update public.leads set
      last_inbound_at = new.created_at,
      first_message_at = coalesce(first_message_at, new.created_at),
      followup_count = 0,
      next_followup_at = null,
      stage = case when stage = 'novo' then 'em_atendimento'::public.lead_stage else stage end
    where id = new.lead_id;
  else
    update public.leads set
      last_outbound_at = new.created_at,
      first_response_at = coalesce(first_response_at, new.created_at)
    where id = new.lead_id;
  end if;
  return new;
end $$;

create trigger messages_stats after insert on public.messages
  for each row execute function public.tg_message_stats();

-- ================================================================ funções usadas pelo n8n

-- 1) entrada de mensagem: cria/atualiza lead, grava mensagem, devolve contexto
create or replace function public.sdr_inbound(
  p_phone text, p_whatsapp_name text, p_content text,
  p_type text default 'text', p_wa_message_id text default null
) returns jsonb
language plpgsql set search_path = '' as $$
declare v_lead public.leads; v_dup boolean := false; v_history jsonb;
begin
  insert into public.leads(phone, whatsapp_name)
  values (p_phone, p_whatsapp_name)
  on conflict (phone) do update set whatsapp_name = coalesce(excluded.whatsapp_name, public.leads.whatsapp_name)
  returning * into v_lead;

  begin
    insert into public.messages(lead_id, direction, sender, type, content, wa_message_id)
    values (v_lead.id, 'in', 'lead', p_type, p_content, p_wa_message_id);
  exception when unique_violation then v_dup := true;  -- webhook repetido da Evolution
  end;

  select * into v_lead from public.leads where id = v_lead.id;

  select coalesce(jsonb_agg(jsonb_build_object('role', m.sender, 'content', m.content, 'at', m.created_at) order by m.created_at), '[]')
    into v_history
  from (select * from public.messages where lead_id = v_lead.id order by created_at desc limit 30) m;

  return jsonb_build_object('duplicate', v_dup, 'lead', to_jsonb(v_lead), 'history', v_history);
end $$;

-- 2) saída: grava a resposta (se idêntica à última enviada, não grava e avisa para não enviar)
create or replace function public.sdr_outbound(
  p_lead_id uuid, p_content text, p_sender public.msg_sender default 'ia', p_wa_message_id text default null
) returns jsonb
language plpgsql set search_path = '' as $$
declare v_last text;
begin
  select content into v_last from public.messages
   where lead_id = p_lead_id and direction = 'out' order by created_at desc limit 1;
  if p_sender = 'ia' and v_last is not null
     and lower(regexp_replace(v_last, '\W', '', 'g')) = lower(regexp_replace(p_content, '\W', '', 'g')) then
    return jsonb_build_object('send', false, 'reason', 'mensagem_repetida');
  end if;
  insert into public.messages(lead_id, direction, sender, content, wa_message_id)
  values (p_lead_id, 'out', p_sender, p_content, p_wa_message_id);
  return jsonb_build_object('send', true);
end $$;

-- 3) atualiza dados de qualificação (só campos enviados)
create or replace function public.sdr_update_lead(p_lead_id uuid, p_data jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v public.leads;
begin
  update public.leads set
    name               = coalesce(p_data->>'name', name),
    email              = coalesce(p_data->>'email', email),
    company            = coalesce(p_data->>'company', company),
    role               = coalesce(p_data->>'role', role),
    segment            = coalesce(p_data->>'segment', segment),
    employees          = coalesce((p_data->>'employees')::int, employees),
    city               = coalesce(p_data->>'city', city),
    challenge          = coalesce(p_data->>'challenge', challenge),
    team_satisfaction  = coalesce(p_data->>'team_satisfaction', team_satisfaction),
    has_norms          = coalesce((p_data->>'has_norms')::boolean, has_norms),
    has_people_process = coalesce((p_data->>'has_people_process')::boolean, has_people_process),
    is_decision_maker  = coalesce((p_data->>'is_decision_maker')::boolean, is_decision_maker),
    urgency            = coalesce(p_data->>'urgency', urgency),
    service_interest   = coalesce(p_data->>'service_interest', service_interest),
    source             = coalesce(p_data->>'source', source),
    qualification_score= coalesce((p_data->>'qualification_score')::int, qualification_score),
    disqualify_reason  = coalesce(p_data->>'disqualify_reason', disqualify_reason),
    stage              = coalesce((p_data->>'stage')::public.lead_stage, stage)
  where id = p_lead_id returning * into v;
  return to_jsonb(v);
end $$;

-- 4) pausa a IA e abre transbordo para a equipe
create or replace function public.sdr_handoff(p_lead_id uuid, p_reason text, p_summary text) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  update public.leads set ai_paused = true, ai_paused_reason = p_reason, ai_paused_at = now()
   where id = p_lead_id;
  select id into v_id from public.handoffs where lead_id = p_lead_id and status = 'aberto' limit 1;
  if v_id is null then
    insert into public.handoffs(lead_id, reason, summary) values (p_lead_id, p_reason, p_summary) returning id into v_id;
  end if;
  return jsonb_build_object('handoff_id', v_id);
end $$;

-- 5) equipe devolve o lead para a IA (botão no CRM)
create or replace function public.sdr_return_to_ai(p_lead_id uuid, p_by text default null) returns void
language plpgsql set search_path = '' as $$
begin
  update public.handoffs set status = 'devolvido', returned_at = now(), returned_by = p_by
   where lead_id = p_lead_id and status = 'aberto';
  update public.leads set ai_paused = false, ai_paused_reason = null, ai_paused_at = null
   where id = p_lead_id;
end $$;

-- 6) reunião criada/alterada pelo webhook do cal.com
create or replace function public.sdr_upsert_meeting(
  p_lead_id uuid, p_booking_uid text, p_start timestamptz, p_end timestamptz,
  p_meet_url text, p_status public.meeting_status default 'agendada'
) returns jsonb
language plpgsql set search_path = '' as $$
declare v public.meetings;
begin
  insert into public.meetings(lead_id, calcom_booking_uid, start_at, end_at, meet_url, status)
  values (p_lead_id, p_booking_uid, p_start, p_end, p_meet_url, p_status)
  on conflict (calcom_booking_uid) do update set
    start_at = excluded.start_at, end_at = excluded.end_at,
    meet_url = coalesce(excluded.meet_url, public.meetings.meet_url), status = excluded.status
  returning * into v;

  insert into public.lead_events(lead_id, type, data)
  values (p_lead_id, 'reuniao_' || p_status::text, jsonb_build_object('start_at', p_start, 'booking', p_booking_uid));

  update public.leads set
    stage = case p_status
              when 'agendada' then 'agendado'::public.lead_stage
              when 'remarcada' then 'agendado'::public.lead_stage
              when 'realizada' then 'reuniao_realizada'::public.lead_stage
              when 'no_show' then 'no_show'::public.lead_stage
              else stage end,
    next_followup_at = null
  where id = p_lead_id;
  return to_jsonb(v);
end $$;

-- 7) leads que precisam de follow-up agora (cadência: 1h, 1 dia, 3 dias, 7 dias)
create or replace function public.sdr_due_followups() returns setof public.leads
language sql stable set search_path = '' as $$
  select * from public.leads l
  where l.ai_paused = false
    and l.stage in ('em_atendimento', 'qualificado')
    and l.last_outbound_at is not null
    and (l.last_inbound_at is null or l.last_outbound_at > l.last_inbound_at)  -- lead não respondeu
    and l.followup_count < 4
    and now() >= l.last_outbound_at + case l.followup_count
          when 0 then interval '1 hour'
          when 1 then interval '1 day'
          when 2 then interval '3 days'
          else interval '7 days' end
$$;

create or replace function public.sdr_mark_followup(p_lead_id uuid) returns void
language plpgsql set search_path = '' as $$
begin
  update public.leads set followup_count = followup_count + 1 where id = p_lead_id;
  insert into public.lead_events(lead_id, type, actor, data)
  select id, 'followup', 'ia', jsonb_build_object('n', followup_count) from public.leads where id = p_lead_id;
  -- após a 4ª tentativa sem resposta, o lead vira perdido
  update public.leads set stage = 'perdido', lost_reason = 'sem_resposta'
   where id = p_lead_id and followup_count >= 4;
end $$;

-- ================================================================ métricas do CRM

create or replace function public.crm_metrics(p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable set search_path = '' as $$
with l as (select * from public.leads where created_at >= p_from and created_at < p_to)
select jsonb_build_object(
  'leads',             (select count(*) from l),
  'em_atendimento',    (select count(*) from l where stage = 'em_atendimento'),
  'qualificados',      (select count(*) from l where qualified_at is not null),
  'desqualificados',   (select count(*) from l where stage = 'desqualificado'),
  'agendados',         (select count(*) from l where scheduled_at is not null),
  'reunioes_realizadas',(select count(*) from l where stage = 'reuniao_realizada'),
  'no_show',           (select count(*) from l where stage = 'no_show'),
  'perdidos',          (select count(*) from l where stage = 'perdido'),
  'taxa_qualificacao', (select round(100.0 * count(*) filter (where qualified_at is not null) / nullif(count(*),0), 1) from l),
  'taxa_agendamento',  (select round(100.0 * count(*) filter (where scheduled_at is not null) / nullif(count(*),0), 1) from l),
  'taxa_agend_qualif', (select round(100.0 * count(*) filter (where scheduled_at is not null) / nullif(count(*) filter (where qualified_at is not null),0), 1) from l),
  'tempo_1a_resposta_seg', (select round(avg(extract(epoch from first_response_at - first_message_at))) from l where first_response_at > first_message_at),
  'tempo_ate_agendar_h',   (select round((avg(extract(epoch from scheduled_at - first_message_at)) / 3600)::numeric, 1) from l where scheduled_at is not null),
  'msgs_recebidas',    (select count(*) from public.messages m where m.direction = 'in'  and m.created_at >= p_from and m.created_at < p_to),
  'msgs_enviadas_ia',  (select count(*) from public.messages m where m.sender = 'ia'     and m.created_at >= p_from and m.created_at < p_to),
  'msgs_enviadas_equipe', (select count(*) from public.messages m where m.sender = 'equipe' and m.created_at >= p_from and m.created_at < p_to),
  'transbordos',       (select count(*) from public.handoffs h where h.opened_at >= p_from and h.opened_at < p_to),
  'transbordos_abertos', (select count(*) from public.handoffs h where h.status = 'aberto'),
  'followups',         (select count(*) from public.lead_events e where e.type = 'followup' and e.created_at >= p_from and e.created_at < p_to),
  'por_origem',        (select coalesce(jsonb_object_agg(k, n), '{}') from (select coalesce(source,'desconhecida') k, count(*) n from l group by 1) s),
  'por_servico',       (select coalesce(jsonb_object_agg(k, n), '{}') from (select coalesce(service_interest,'nao_informado') k, count(*) n from l group by 1) s),
  'por_segmento',      (select coalesce(jsonb_object_agg(k, n), '{}') from (select coalesce(segment,'nao_informado') k, count(*) n from l group by 1) s),
  'motivos_transbordo',(select coalesce(jsonb_object_agg(reason, n), '{}') from (select reason, count(*) n from public.handoffs h where h.opened_at >= p_from and h.opened_at < p_to group by 1) s),
  'motivos_desqualificacao', (select coalesce(jsonb_object_agg(k, n), '{}') from (select coalesce(disqualify_reason,'outro') k, count(*) n from l where stage = 'desqualificado' group by 1) s),
  'por_dia',           (select coalesce(jsonb_agg(jsonb_build_object('dia', d, 'leads', n, 'agendados', a) order by d), '[]')
                          from (select date_trunc('day', created_at)::date d, count(*) n, count(*) filter (where scheduled_at is not null) a from l group by 1) s),
  'por_hora',          (select coalesce(jsonb_agg(jsonb_build_object('hora', h, 'msgs', n) order by h), '[]')
                          from (select extract(hour from created_at at time zone 'America/Maceio')::int h, count(*) n
                                from public.messages m where m.direction = 'in' and m.created_at >= p_from and m.created_at < p_to group by 1) s)
)
$$;

-- ================================================================ segurança
-- n8n usa a service_role (ignora RLS). O CRM usa usuários autenticados da equipe.
alter table public.leads enable row level security;
alter table public.messages enable row level security;
alter table public.lead_events enable row level security;
alter table public.handoffs enable row level security;
alter table public.meetings enable row level security;

create policy equipe_all on public.leads       for all to authenticated using (true) with check (true);
create policy equipe_all on public.messages    for all to authenticated using (true) with check (true);
create policy equipe_all on public.lead_events for all to authenticated using (true) with check (true);
create policy equipe_all on public.handoffs    for all to authenticated using (true) with check (true);
create policy equipe_all on public.meetings    for all to authenticated using (true) with check (true);

-- funções do agente: só service_role (n8n). CRM: métricas e devolver para IA.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.crm_metrics(timestamptz, timestamptz) to authenticated;
grant execute on function public.sdr_return_to_ai(uuid, text) to authenticated;
grant execute on function public.sdr_handoff(uuid, text, text) to authenticated;
grant execute on all functions in schema public to service_role;

-- realtime para o CRM atualizar sozinho
alter publication supabase_realtime add table public.leads, public.messages, public.handoffs, public.meetings;
