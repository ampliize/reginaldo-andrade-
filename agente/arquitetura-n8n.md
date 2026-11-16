# Arquitetura — Agente SDR "Pedro" + CRM

```
WhatsApp (79 99993-3769)
   │  Evolution API  ──webhook messages.upsert──►  n8n  ──►  Supabase (banco_de_dados_reginaldo)  ◄──  CRM (Vercel)
   │                                                │
   ◄──────────── sendText ──────────────────────────┤──►  OpenAI (AI Agent "Pedro" + Whisper)
                                                    └──►  cal.com API (horários / agendamento → Google Meet)
```

Missão do agente: **atender → qualificar → agendar**. Depois do agendamento, acabou.

---

## Workflow 1 — "Pedro | Atendimento" (gatilho: Webhook da Evolution)

| # | Nó | O que faz |
|---|---|---|
| 1 | **Webhook** `POST /pedro` | Recebe `messages.upsert` da Evolution. |
| 2 | **Filtro** | Ignora grupos (`@g.us`), status/broadcast e eventos que não são mensagem. |
| 3 | **IF fromMe** | `true` → mensagem enviada pelo celular da equipe → RPC `sdr_team_message(phone, texto, tipo, id)` (registra como *equipe* e **pausa a IA**). Fim. |
| 4 | **Switch tipo** | `conversation`/`extendedTextMessage` → texto · `audioMessage` → baixa o base64 (Evolution `getBase64FromMediaMessage`) e **transcreve** com OpenAI (`whisper-1` / `gpt-4o-mini-transcribe`) · imagem/documento/sticker → texto `"[imagem]"` + legenda, se houver. |
| 5 | **RPC `sdr_inbound`** | Cria/atualiza o lead, grava a mensagem, devolve `lead`, `history` e `duplicate`. |
| 6 | **IF duplicate** | Webhook repetido → fim. |
| 7 | **IF `lead.ai_paused`** | IA pausada → **não responde**. Fim. (A mensagem já está no CRM para a equipe.) |
| 8 | **IF etapa encerrada** | `desqualificado`, `perdido` ou `reuniao_realizada` → não responde; abre transbordo (`sdr_handoff`, motivo `assunto_especifico`). |
| 9 | **Debounce 15 s** | Redis/Wait: espera o lead terminar de digitar (várias mensagens seguidas viram uma só resposta). Só segue a execução da **última** mensagem recebida. |
| 10 | **AI Agent (OpenAI `gpt-4.1` ou `gpt-4o`)** | System message = `prompt-pedro.md` com as variáveis do lead. Memória = `history` vinda do banco (não usar memória do n8n). Ferramentas abaixo. |
| 11 | **IF `NO_REPLY`** ou transbordo chamado | Não envia nada. Fim. |
| 12 | **Split `---`** | Divide em até 2 mensagens. |
| 13 | **RPC `sdr_outbound`** | Se `send=false` (mensagem repetida) → não envia. |
| 14 | **Evolution `sendText`** | Com "digitando…" (`delay` proporcional ao tamanho do texto). |
| 15 | **RPC `sdr_set_wa_id`** | Grava o id retornado pela Evolution (para o passo 3 não confundir com a equipe). |
| 16 | **Erro em qualquer nó** | Error Trigger → `sdr_handoff(motivo erro)` + notificação. A IA nunca manda mensagem de erro para o lead. |

### Ferramentas do AI Agent

| Ferramenta | Implementação no n8n |
|---|---|
| `atualizar_lead(dados)` | Supabase RPC `sdr_update_lead(p_lead_id, p_data)` |
| `buscar_horarios(data_inicio, data_fim)` | HTTP GET `https://api.cal.com/v2/slots?eventTypeId=…&start=…&end=…&timeZone=America/Maceio` (header `cal-api-version: 2024-09-04`). Retornar no máximo 6 horários. |
| `agendar_reuniao(inicio, nome, email)` | HTTP POST `https://api.cal.com/v2/bookings` (header `cal-api-version: 2024-08-13`) com `eventTypeId`, `start`, `attendee {name, email, timeZone, phoneNumber}`, `metadata {lead_id}`. O event type no cal.com tem a localização **Google Meet**. Em seguida: RPC `sdr_upsert_meeting(...)`. |
| `transferir_para_equipe(reason, summary)` | RPC `sdr_handoff` + **notificação** (Evolution `sendText` para o WhatsApp do Reginaldo/Larissa): "⚠️ Lead precisa de atendimento: {nome} — {motivo}. {resumo}. Abrir no CRM: {link}". |

---

## Workflow 2 — "Pedro | Cal.com" (gatilho: Webhook do cal.com)

Eventos `BOOKING_CREATED`, `BOOKING_RESCHEDULED`, `BOOKING_CANCELLED`, `MEETING_ENDED`, `BOOKING_NO_SHOW_UPDATED`
→ acha o lead por `metadata.lead_id` (ou pelo telefone/e-mail do participante)
→ RPC `sdr_upsert_meeting(lead_id, uid, start, end, meet_url, status)`
→ cancelado: `sdr_handoff(motivo cancelamento)`.

Isso cobre também quem agendar direto pelo link do cal.com.

## Workflow 3 — "Pedro | Lembretes e follow-up" (gatilho: Schedule a cada 15 min)

- **Follow-up** de quem parou de responder: RPC `sdr_due_followups()` → para cada lead, a OpenAI gera uma mensagem curta de retomada (sem repetir as anteriores) → `sdr_outbound` → Evolution → `sdr_mark_followup`. Cadência: 1 h, 1 dia, 3 dias, 7 dias. Depois disso o lead vira **perdido**.
- **Lembrete da reunião**: 24 h e 1 h antes (consulta `meetings` com `status in ('agendada','remarcada')`), com o link do Meet.
- Respeitar horário: follow-ups só entre 8h e 20h, de segunda a sábado.

## Workflow 4 — "Pedro | Conexão WhatsApp" (gatilho: Webhook chamado pelo CRM)

Mesmo padrão do CRM da Cabelos by Karol: **o CRM não guarda nenhuma chave**. A URL deste webhook fica em `config_bot.n8n_webhook_whatsapp_url`; a chave da Evolution fica só na credencial do n8n.

1. **Webhook** `POST /pedro-whatsapp` (CORS liberado para o domínio do CRM) — corpo `{ action: "status" | "connect" | "logout" | "webhook" }`.
2. **Valida o login**: HTTP GET `https://hnxqeccyasyyajtwlbal.supabase.co/auth/v1/user` com o `Authorization` recebido + header `apikey` (publishable). Se não for 200 → responde 401.
3. **Lê `config_bot`** (`evolution_base_url`, `evolution_instancia`, `n8n_webhook_atendimento_url`).
4. **Switch action** (Evolution API v2, header `apikey` da credencial):
   - `status` → `GET /instance/connectionState/{instancia}` (+ `fetchInstances` quando `open`) → `{ state, number, profileName }`
   - `connect` → se a instância não existe, `POST /instance/create` (com o webhook do atendimento); senão `GET /instance/connect/{instancia}` → `{ qr, pairingCode }` (ou `{ connected: true }`)
   - `logout` → `DELETE /instance/logout/{instancia}`
   - `webhook` → `POST /webhook/set/{instancia}` apontando para `n8n_webhook_atendimento_url`
5. **Respond to Webhook** com o JSON.

---

## Regras de comportamento garantidas pelo sistema (não só pelo prompt)

| Regra | Onde é garantida |
|---|---|
| Não manda mensagem repetida | `sdr_outbound` compara com a última mensagem enviada e bloqueia; o webhook repetido é bloqueado por `wa_message_id` único. |
| Não sabe responder → pausa e notifica | Ferramenta `transferir_para_equipe` → `sdr_handoff` + WhatsApp para a equipe; resposta `NO_REPLY`. |
| Depois de transferir, não volta a atender sozinha | Passo 7: com `ai_paused = true` a execução para antes da IA. |
| Só volta quando a equipe devolve | Botão **"Devolver para a IA"** no CRM → `sdr_return_to_ai`. |
| Equipe respondeu pelo celular → IA para | Passo 3: `sdr_team_message` pausa automaticamente. |
| Não fala de preço / fora de contexto | Prompt + transbordo na insistência. |
| Não envia áudio, só escuta | Passo 4 transcreve; a saída é sempre `sendText`. |
| Erro técnico não chega ao lead | Error Trigger → transbordo. |

---

## Credenciais necessárias

| Serviço | O que precisamos |
|---|---|
| Supabase | URL `https://hnxqeccyasyyajtwlbal.supabase.co` + **service_role key** numa credencial do n8n (nunca no CRM) |
| CRM (Vercel) | Nenhuma variável de ambiente: a URL e a chave publicável do Supabase são públicas e estão no código; o resto fica em `config_bot`. |
| Evolution API | API key global numa credencial do n8n. A URL vai em `config_bot.evolution_base_url`. A instância `reginaldo` é criada e conectada pelo CRM (Configurações → Gerar QR Code). |
| OpenAI | API key (AI Agent + transcrição dos áudios) |
| cal.com | API key + ID do event type "Diagnóstico — 30 min" (com Google Meet e o Google Agenda do Reginaldo conectados) |
| Notificação | Números de WhatsApp do Reginaldo e da Larissa |
