# RelayDesk WhatsApp SaaS MVP

MVP SaaS em Nuxt 4 + Vue 3 para atendimento via WhatsApp com times, multiplos numeros, QR Code via Evolution API, CRM de contatos, mensagens em tempo real e isolamento multi-tenant por Clerk Organizations.

## Stack

- Nuxt 4, Vue 3, TypeScript
- TailwindCSS 4 e Nuxt UI
- Clerk + Clerk Organizations
- Supabase Postgres, RLS e Supabase Realtime
- Evolution API como gateway WhatsApp
- Pinia para stores
- Resend, Upstash Redis e Sentry preparados por env

## Instalar

```bash
npm install
cp .env.example .env
npm run dev
```

O dev server usado nesta entrega ficou em:

```bash
http://127.0.0.1:3001
```

Se a porta estiver livre, `npm run dev` normalmente abre em `http://localhost:3000`.

## Variaveis

Preencha `.env` com:

```bash
NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

EVOLUTION_API_URL=
EVOLUTION_API_KEY=
EVOLUTION_WEBHOOK_URL=
```

Sem `EVOLUTION_API_URL` e `EVOLUTION_API_KEY`, o server usa um adapter mock de desenvolvimento. Ele cria QR fake, simula status conectado e habilita `/api/dev/simulate-message`.

## Supabase

1. Crie um projeto Supabase.
2. Rode a migration em `supabase/migrations/202605190001_initial_schema.sql`.
3. Confirme que Realtime esta habilitado para:
   - `whatsapp_accounts`
   - `conversations`
   - `messages`
4. Configure um JWT template no Clerk chamado exatamente `supabase` com claims de organizacao. O RLS espera `org_id` ou `o.id` no JWT:

```json
{
  "aud": "authenticated",
  "role": "authenticated",
  "org_id": "{{org.id}}",
  "org_role": "{{org.role}}",
  "sub": "{{user.id}}"
}
```

O frontend usa `@supabase/supabase-js` com `accessToken` vindo do Clerk, e as APIs usam service role apenas no server.

## Clerk

Ative Organizations no Clerk. As permissoes do MVP aceitam:

- `org:owner`
- `org:admin`
- `org:agent`
- `org:member`

Owners/admins conectam numeros e convidam membros. Agents visualizam e respondem mensagens.

## Evolution API

Configure:

```bash
EVOLUTION_API_URL=https://sua-evolution-api.com
EVOLUTION_API_KEY=sua-chave
EVOLUTION_WEBHOOK_URL=https://seu-dominio.com/api/webhooks/evolution
```

O client fica em `server/utils/evolution.ts` e implementa:

- `createInstance`
- `connectInstance`
- `getConnectionState`
- `sendTextMessage`
- `logoutInstance`
- `deleteInstance`

O webhook `POST /api/webhooks/evolution` identifica a conta por `instance_name`, normaliza eventos, cria contato/conversa/mensagem, atualiza status de conexao e salva `raw_payload`.

## Fluxo local

1. Entre com Clerk.
2. Crie ou selecione uma organizacao.
3. Acesse `Settings > WhatsApp`.
4. Clique em `Conectar WhatsApp`.
5. Escaneie o QR Code real ou use o mock em desenvolvimento.
6. Receba mensagens pelo webhook ou simule pelo botao `Simular mensagem`.
7. Acesse `/messages` para ver conversas e responder.

## Estrutura

- `app/pages`: login, dashboard, messages, contacts, settings
- `app/components`: sidebar, topbar, QR modal, cards, listas, thread e composer
- `app/composables`: organizacao atual, fetches e Supabase Realtime
- `stores`: Pinia stores de mensagens, conversas e contas WhatsApp
- `server/api`: endpoints multi-tenant
- `server/utils`: Supabase, Clerk, auth, tenant, Evolution, webhook e rate limit
- `types`: tipos do dominio e Database Supabase
- `supabase/migrations`: schema SQL

## Seguranca

- `SUPABASE_SERVICE_ROLE_KEY` nunca e usada no frontend.
- Evolution API nunca e chamada no frontend.
- Todas as APIs validam Clerk auth e organizacao ativa.
- Todas as queries server-side filtram por `clerk_org_id`.
- O webhook associa eventos por `instance_name`, nao por telefone.
- RLS restringe Realtime por `org_id` do JWT Clerk.
- Rate limit com Upstash e aplicado quando `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` estao configurados.

## Limitacoes do MVP

- Observacoes do contato ainda sao apenas campo visual.
- Roles customizadas precisam existir no Clerk se voce usar `org:owner` ou `org:agent`.
- O parser do webhook e defensivo, mas pode precisar de ajuste fino para variacoes especificas da sua versao da Evolution API.
- Envio implementado apenas para texto.

## Proximos passos

- Persistir notas, tags e atribuicao de responsavel.
- Adicionar fila de envio e retry com Upstash.
- Adicionar status de entrega/leitura em `message_events`.
- Criar telas de auditoria e logs do webhook.
- Configurar Sentry e alertas de falha de webhook.
- Adicionar testes de API e E2E com credenciais de staging.
