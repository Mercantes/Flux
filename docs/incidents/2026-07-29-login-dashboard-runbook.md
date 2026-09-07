# 🚨 Incidente — Login com erro + Dashboard zerado (29/07/2026)

**Para:** @devops (Gage)
**Prioridade:** URGENTE — time de vendas parado
**Status:** aguardando ação no Coolify

---

## TL;DR

**O banco e o Supabase estão 100% no ar. Nada foi perdido.** O problema é a **aplicação no Coolify** — camada de **sessão server-side**. Provável causa: **múltiplas réplicas com config inconsistente** (tipicamente a `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` diferente entre réplicas) **ou uma réplica que subiu quebrada** no redeploy do **#194** (`04068fb`, ontem ~20:45).

**Ação mais provável de resolver:** fixar a `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` + redeploy (Passo 2 + 3A). Rollback é a rede de segurança (3B).

---

## Sintomas

- Tela de login trava em **"Entrando..."** e cai em **"Erro de autenticação — Ocorreu um erro ao processar sua solicitação."**
- Login é **intermitente**: erra numa tentativa, entra na outra.
- Já logado, o **Dashboard mostra tudo 0** (Leads, Reuniões marcadas/realizadas, Atividades, Taxa de comparecimento) e "Sem dados".

## O que já foi verificado (é app, não é banco)

| Componente | Estado | Como foi testado |
|---|---|---|
| App — `/login`, `/api/health` | ✅ 200 | curl externo |
| Supabase Auth | ✅ saudável | `/auth/v1/settings` = 200; token grant (cred. falsa) = 400 `invalid_credentials` |
| Supabase REST | ✅ 200 | curl com apikey |
| **Banco (dados)** | ✅ **vivo e com dados** | consulta ao vivo: **4.846 leads, 82 reuniões marcadas em julho, 62 realizadas, 550 interações nas últimas 24h** |

> O dashboard mostra **0**, mas o banco tem **82 reuniões e 4.846 leads** → o app **não está lendo os dados sob a sessão do usuário**. Não é o banco.

## Por que NÃO é o código do #194

O deploy em produção é o **#194 (`04068fb`)**. O diff do #194 alterou **apenas 4 arquivos, todos em `src/features/whatsapp-calls/`** (persist-call + ActivityWhatsAppCallPanel), **sem migração, sem tocar em auth/dashboard/middleware/sessão**. Logo, o código não explica a falha app-wide — o gatilho foi o **redeploy** (ambiente/réplicas), não o código.

---

## RUNBOOK — ordem de execução

### Passo 1 — Achar a réplica ruim *(~2 min)*
- Coolify → app **Enriquece** → ver **quantas réplicas** e o status de cada. Alguma em `unhealthy` / `restarting` / `crash loop` = foco.
- Abrir os **logs do container** (últimos minutos) e procurar:
  - `Failed to find Server Action`
  - erro de *decrypt* / *encryption key*
  - stack trace de boot / crash

### Passo 2 — Corrigir a causa provável: a chave *(~3 min)*
- Coolify → **Environment Variables** → confirmar que `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`:
  - **existe**, é **base64 de 32 bytes**, e é **idêntica em build e runtime** (e igual em todas as réplicas).
- Se estiver **vazia / ausente / variando entre réplicas**, gerar uma fixa e aplicar em **build + runtime**:

```bash
openssl rand -base64 32
```

> Esta é a landmine já conhecida do projeto: sem chave fixa igual em todas as instâncias, **todas as Server Actions falham em produção** (login inclusive). Fixar aqui é o que impede o problema de voltar a cada auto-deploy.

- Enquanto estiver nas envs, confirmar também presentes/iguais em todas as réplicas:
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`.

### Passo 3 — Restaurar serviço são *(o desbloqueio)*
- **Opção A (recomendada, mais rápida):** **Redeploy** com a chave já fixada.
  - Se for multi-réplica: **escalar para 1 réplica temporariamente**, validar (Passo 4), depois voltar a escalar. Isso elimina a inconsistência cross-réplica na hora.
- **Opção B (fallback, se A não resolver):** **Rollback para o deploy anterior #193 (`21a6c26`)**.
  - Coolify → **Deployments** → selecionar o deployment de `21a6c26` → **Redeploy / Rollback**.
  - ✅ **Seguro:** o #194 **não teve migração** — rollback é só de código, o banco não é afetado.

### Passo 4 — Confirmar que voltou *(~2 min)*
- Fazer login em `app.enriqueceai.com.br` **2–3 vezes** (pra cair em réplicas diferentes) → **sem** "Erro de autenticação".
- Dashboard de **julho** deve mostrar **~82 reuniões marcadas, ~62 realizadas, leads > 0** — **não zeros**.
  - **Critério de sucesso:** os números reais (82 / 62 / 4.846) aparecem. Se ainda zerar, o fix não pegou → repetir com Opção B.

### Passo 5 — Pós-incidente (não perder)
- Garantir a `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` **fixa em definitivo** — senão **todo merge na `main`** (auto-deploy) pode reintroduzir isso.
- O #194 (whatsapp-calls) é inofensivo ao auth — pode voltar depois, com o deploy já corrigido.

---

## Alternativa ao rollback pela UI: rollback via git (@devops)

> ⚠️ **Ler antes:** o #194 **não é a causa** (só mexeu em `whatsapp-calls`). Reverter via git equivale ao rollback pro #193 — o valor real é **forçar um redeploy limpo** e tirar o #194 da jogada. **Só resolve de fato se a `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` estiver fixada (Passo 2) ANTES** — senão o deploy do próprio revert pode subir igualmente quebrado.

Fatos confirmados: `04068fb` é **squash de 1 parent** (revert direto, sem `-m`) e é o **topo da `main`** (aplica limpo). Push exclusivo do @devops.

### Caminho rápido — revert direto na `main` (dispara auto-deploy)
```bash
git checkout main
git fetch origin
git pull --ff-only origin main          # garante main espelhando o remoto

git revert --no-edit 04068fb            # cria o commit de revert do #194

git push origin main                    # @devops — dispara o auto-deploy no Coolify
```

### Caminho com PR (se preferir revisão — mais lento, CI + merge)
```bash
git checkout main && git fetch origin && git pull --ff-only origin main
git checkout -b revert/194-login-outage
git revert --no-edit 04068fb
git push -u origin revert/194-login-outage
gh pr create --repo v4amaraltech/EnriqueceAI-pro --base main \
  --title "revert: rollback emergencial do #194 (login/dashboard fora do ar)" \
  --body "Rollback emergencial. Banco/Supabase OK; app no Coolify com sessão server-side quebrada pós-redeploy do #194. Revert força redeploy limpo. Fixar NEXT_SERVER_ACTIONS_ENCRYPTION_KEY antes."
# depois: merge do PR (auto-deploy dispara no merge)
```

### Reverter o revert (quando o #194 puder voltar, com o deploy já corrigido)
```bash
git checkout main && git fetch origin && git pull --ff-only origin main
git revert --no-edit <sha_do_commit_de_revert>
git push origin main
```

**Verificação:** mesma do Passo 4 — login sem erro + dashboard de julho com **82 / 62 / leads > 0**.

---

## Referências rápidas

- Deploy atual (com problema): **#194** `04068fb` — "registra cada tentativa de ligação no histórico" (merge 28/07 ~20:45)
- Rollback alvo (última versão sã): **#193** `21a6c26` — "checagens de duplicidade cegas por RLS"
- Supabase project ref: `dhkmonctyoaenejemkrt` · Org: V4 Company Amaral (`c2727473-1df8-4faa-9264-a9fc1759fe3b`)
- Deploy = **Coolify** (não Vercel). Auto-deploy a cada merge na `main`.
