-- Mensagens enviadas pelo celular/WhatsApp Web (fromMe=true na Evolution) que NÃO foram enviadas pela IA
-- são da equipe: registra como 'equipe' e pausa a IA (a equipe assumiu a conversa).

-- grava o id da Evolution na última mensagem da IA (chamado logo após o envio)
create or replace function public.sdr_set_wa_id(p_lead_id uuid, p_content text, p_wa_message_id text) returns void
language plpgsql set search_path = '' as $$
begin
  update public.messages set wa_message_id = p_wa_message_id
   where id = (select id from public.messages
                where lead_id = p_lead_id and sender = 'ia' and wa_message_id is null and content = p_content
                order by created_at desc limit 1);
end $$;

create or replace function public.sdr_team_message(p_phone text, p_content text, p_type text, p_wa_message_id text) returns jsonb
language plpgsql set search_path = '' as $$
declare v_lead uuid;
begin
  -- já registrada (é uma mensagem da própria IA)
  if exists (select 1 from public.messages where wa_message_id = p_wa_message_id) then
    return jsonb_build_object('ignored', true);
  end if;
  select id into v_lead from public.leads where phone = p_phone;
  if v_lead is null then return jsonb_build_object('ignored', true); end if;
  -- corrida: a IA acabou de enviar exatamente este texto e o id ainda não foi gravado
  if exists (select 1 from public.messages where lead_id = v_lead and sender = 'ia' and content = p_content
              and created_at > now() - interval '2 minutes') then
    return jsonb_build_object('ignored', true);
  end if;

  insert into public.messages(lead_id, direction, sender, type, content, wa_message_id)
  values (v_lead, 'out', 'equipe', p_type, p_content, p_wa_message_id);

  if not (select ai_paused from public.leads where id = v_lead) then
    perform public.sdr_handoff(v_lead, 'pediu_humano', 'A equipe respondeu pelo WhatsApp e assumiu o atendimento.');
  end if;
  return jsonb_build_object('ignored', false, 'lead_id', v_lead);
end $$;

revoke execute on function public.sdr_set_wa_id(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.sdr_team_message(text, text, text, text) from public, anon, authenticated;
grant execute on function public.sdr_set_wa_id(uuid, text, text) to service_role;
grant execute on function public.sdr_team_message(text, text, text, text) to service_role;
