# hey-piper

App de controle financeiro pessoal: orçamento mensal por categoria, transações, cartão de crédito com parcelamentos, metas, evolução do patrimônio e importação inteligente de extratos com IA.

Cada pessoa roda **a sua própria instância**, com o seu próprio banco de dados. O app é de um único usuário, protegido por senha. O repositório não vem com nenhum dado: você começa com as categorias padrão e mais nada.

## Funcionalidades

- **Dashboard**: receitas, despesas, saldo, ritmo de gastos do mês, projeção de fechamento e comprometimento da renda
- **Orçamento**: limite mensal por categoria, com cópia entre meses
- **Transações**: busca, filtros, edição em massa, reembolsos e transferências
- **Cartão de Crédito**: fatura e parcelamentos ativos
- **Análise**: tendência mensal e comparação entre categorias, mais o **Relatório do Mês** gerado por IA
- **Patrimônio**: saldo das contas, investimentos e dívidas via Open Finance (Pluggy), com foto diária automática, além de bens manuais (imóvel, veículo, conta no exterior…)
- **File Import**: importa extratos e faturas (CSV, XLS, XLSX) e categoriza com regras, histórico e IA
- **Smart Import (API)**: puxa as transações direto do banco via Pluggy

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS + Recharts |
| Backend | Vercel Serverless Functions (pasta `api/`) |
| Banco | PostgreSQL no Supabase |
| IA | Anthropic Claude (ou OpenAI, opcional) |
| Open Finance | Pluggy (opcional) |

## Custos

| Serviço | Plano | Custo |
|---|---|---|
| GitHub | Free | grátis |
| Supabase | Free | grátis (500 MB de banco; o projeto é pausado após 7 dias sem uso, e você reativa no painel) |
| Vercel | Hobby | grátis (uso pessoal) |
| Anthropic | pré-pago | centavos por importação/relatório; exige crédito mínimo na conta |
| Pluggy | — | veja os planos em [pluggy.ai](https://pluggy.ai); opcional |

---

## Instalação passo a passo

Tempo estimado: 30–45 minutos.

### Onde ficam as chaves e senhas

Nos passos 2 a 5 você vai juntar chaves e senhas (URL do banco, chave da IA, etc.). **Nenhuma delas é escrita no código.** O caminho é este:

1. **Antes de começar**, faça uma cópia do arquivo [`.env.example`](.env.example) com o nome `.env` (na pasta do projeto, se você clonou, ou num editor de texto qualquer). Ele já tem todas as variáveis listadas, vazias, com um comentário explicando cada uma.
2. **A cada passo**, cole o valor obtido depois do `=` da variável correspondente. Exemplo:
   ```
   ANTHROPIC_API_KEY=sk-ant-api03-abc123...
   ```
3. **No passo 6**, você cola o conteúdo inteiro desse arquivo na tela **Environment Variables** da Vercel. É de lá que o app publicado lê os valores.

O `.env` também é o arquivo usado para rodar o app no seu computador (veja [Rodando localmente](#rodando-localmente-desenvolvimento)). Ele está no `.gitignore` e **nunca deve ir para o GitHub**. Guarde uma cópia num lugar seguro, como um gerenciador de senhas.

Resumo das variáveis:

| Variável | Obrigatória? | Vem do passo |
|---|---|---|
| `DATABASE_URL` | sim | 2 — Supabase |
| `APP_PASSWORD` | sim | 4 — Senhas e segredos |
| `SESSION_SECRET` | sim | 4 — Senhas e segredos |
| `ANTHROPIC_API_KEY` | sim* | 3 — Anthropic |
| `MODEL_SMART_IMPORT`, `MODEL_MONTHLY_REPORT` | não | 3 — Anthropic |
| `OPENAI_API_KEY` | não | 3 — Anthropic |
| `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, `PLUGGY_ITEM_ID` | não | 5 — Pluggy |
| `CRON_SECRET` | se usar Pluggy | 4 — Senhas e segredos |

\* Sem ela o app funciona, mas o File Import não categoriza com IA e o Relatório do Mês não é gerado.

### Pré-requisitos

- [Node.js](https://nodejs.org) 20 ou superior (só para rodar localmente; o deploy não exige)
- [Git](https://git-scm.com)
- `openssl` para gerar segredos (já vem no macOS e no Linux; no Windows, use o Git Bash)

---

### 1. GitHub: tenha sua cópia do código

1. Crie uma conta em [github.com](https://github.com) se ainda não tiver.
2. Crie a sua cópia. Escolha uma das opções:
   - **Fork** (mais simples): clique em **Fork** no topo desta página. O fork de um repositório público é sempre público. Não tem problema, porque nenhuma senha ou dado vai para o código; tudo fica nas variáveis de ambiente da Vercel e no Supabase.
   - **Repositório privado**: crie um repositório vazio e privado no GitHub (ex.: `meu-hey-piper`) e rode:
     ```bash
     git clone https://github.com/heypiper26/hey-piper.git
     cd hey-piper
     git remote set-url origin https://github.com/<seu-usuario>/meu-hey-piper.git
     git push -u origin main
     ```

> ⚠️ **Nunca faça commit do arquivo `.env`.** Ele já está no `.gitignore`.

---

### 2. Supabase: banco de dados

1. Crie uma conta em [supabase.com](https://supabase.com) (dá para entrar com o GitHub).
2. Clique em **New project**:
   - **Name**: `hey-piper` (ou o que quiser)
   - **Database Password**: clique em **Generate a password** e **anote a senha**. Você vai precisar dela no item 6.
   - **Region**: `South America (São Paulo)`, para menor latência no Brasil
3. Aguarde o projeto ficar pronto (~2 min).
4. No menu lateral, abra o **SQL Editor** e clique em **New query**.
5. Copie **todo** o conteúdo do arquivo [`schema.sql`](schema.sql), cole no editor e clique em **Run**. A mensagem deve ser `Success. No rows returned` (ou parecida). Isso cria as tabelas e as 19 categorias padrão.
6. Pegue a connection string: clique no botão **Connect** no topo do projeto, depois em **Connection String** → **Transaction pooler** (porta **6543**). Ela tem este formato:
   ```
   postgresql://postgres.abcdefghijklmnop:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
   ```
   Troque `[YOUR-PASSWORD]` (inclusive os colchetes) pela senha do item 2. O resultado é o seu **`DATABASE_URL`**.

> Use o **Transaction pooler (6543)**, não a "Direct connection" (5432). A conexão direta é só IPv6 e não funciona nas funções da Vercel.
>
> Se a senha do banco tiver caracteres especiais (`@`, `#`, `/`, `?`…), eles precisam ser [codificados na URL](https://www.urlencoder.org/). Gerar uma senha só com letras e números evita isso.

---

### 3. Anthropic: chave da IA

1. Crie uma conta em [console.anthropic.com](https://console.anthropic.com).
2. Em **Billing**, adicione créditos. O uso do app é baixo: cada importação ou relatório custa poucos centavos de dólar.
3. Em **API Keys** → **Create Key**, dê um nome (ex.: `hey-piper`) e copie a chave (`sk-ant-...`). Ela aparece **uma única vez**. Esse é o seu **`ANTHROPIC_API_KEY`**.

**Modelos (opcional).** Por padrão, os dois recursos de IA usam `claude-sonnet-5-5`. Para trocar, defina:

- `MODEL_SMART_IMPORT`: modelo da categorização no File Import
- `MODEL_MONTHLY_REPORT`: modelo do Relatório do Mês

Modelos `claude-*` usam a Anthropic. Qualquer outro nome (ex.: `gpt-5`) usa a OpenAI e exige também `OPENAI_API_KEY` (crie em [platform.openai.com/api-keys](https://platform.openai.com/api-keys)).

---

### 4. Senhas e segredos

**Senha de acesso: `APP_PASSWORD`**

A senha padrão sugerida é:

```
heypiper
```

Use-a só no primeiro login e **troque logo em seguida** em **Configurações → Alterar senha de acesso**. A partir daí, a nova senha fica guardada no banco (com hash scrypt), e o `APP_PASSWORD` deixa de ser aceito. Se preferir, defina direto uma senha sua no `APP_PASSWORD`.

O login tem proteção contra força bruta: 5 tentativas erradas bloqueiam o IP por 15 minutos.

**`SESSION_SECRET` e `CRON_SECRET`**

São strings aleatórias longas. Gere uma para cada no terminal:

```bash
openssl rand -hex 32   # copie o resultado → SESSION_SECRET
openssl rand -hex 32   # rode de novo      → CRON_SECRET
```

- **`SESSION_SECRET`** assina o cookie de login. Ele precisa ser secreto e **diferente da senha**: quem souber esse valor consegue entrar no app sem a senha.
- **`CRON_SECRET`** protege a rota que a Vercel chama todo dia para gravar a foto do patrimônio. A Vercel envia esse valor automaticamente no cabeçalho `Authorization` da chamada agendada.

Sem `openssl`? Qualquer gerador de senhas que produza 64 caracteres aleatórios serve.

---

### 5. Pluggy: conexão com o banco (opcional)

A [Pluggy](https://pluggy.ai) é um agregador de Open Finance. Com ela, o app busca transações e saldos direto do seu banco. **Sem a Pluggy, o app funciona normalmente** com importação de arquivos; só as páginas **Smart Import (API)** e a atualização automática do **Patrimônio** ficam indisponíveis.

O caminho para uso pessoal é o **Meu Pluggy**: você conecta seus bancos via Open Finance em meu.pluggy.ai e depois autoriza a sua aplicação da Pluggy a ler essa conexão. O passo a passo oficial está no repositório [pluggyai/meu-pluggy](https://github.com/pluggyai/meu-pluggy).

> ⏱️ **Faça este passo de uma vez.** A conta no dashboard da Pluggy começa com um **trial de 15 dias**, e a conexão com o Meu Pluggy só pode ser feita enquanto o trial estiver ativo. Crie a conta no dashboard só quando estiver pronto para ir até o fim.
>
> Os menus da Pluggy mudam com alguma frequência. Se algum nome abaixo não bater exatamente, procure o equivalente ou consulte a [documentação da Pluggy](https://docs.pluggy.ai).

**5.1. Conecte seus bancos no Meu Pluggy**

1. Crie uma conta em [meu.pluggy.ai](https://meu.pluggy.ai).
2. Clique no botão principal para conectar, procure o seu banco e conclua a autorização Open Finance (você será levado ao app/site do banco para aprovar).

**5.2. Client ID e Client Secret**

1. Crie uma conta em [dashboard.pluggy.ai](https://dashboard.pluggy.ai) (se pedir, crie também um *team*).
2. Vá em **Applications** e crie uma aplicação de **desenvolvimento** (ex.: `hey-piper`).
3. Na página da aplicação, copie:
   - **Client ID** → `PLUGGY_CLIENT_ID`
   - **Client Secret** → `PLUGGY_CLIENT_SECRET` (guarde com cuidado: ele dá acesso aos seus dados bancários)
4. Nas configurações da aplicação, inclua o conector **MeuPluggy** na lista de conectores habilitados.

**5.3. Item ID**

Na Pluggy, um **item** é uma conexão autorizada com uma instituição. O id vai em `PLUGGY_ITEM_ID`.

1. Na página da sua aplicação no dashboard, clique em **Ir para Demo**.
2. No Demo, conecte o **MeuPluggy** e faça login (OAuth) com a conta do passo 5.1.
3. No Demo, abra o menu de três pontos no canto superior direito e clique em **Copiar Item ID**. Esse valor (um UUID como `3f1c2a9e-...`) é o **`PLUGGY_ITEM_ID`**.

Depois de autorizada, a conexão é atualizada pela Pluggy uma vez por dia.

> ⚠️ **Um banco por item.** Se você conectou vários bancos no Meu Pluggy, o passo 5.3 precisa ser feito **uma vez para cada banco**, e cada um gera um Item ID diferente. Este app usa **um único** `PLUGGY_ITEM_ID`, então escolha o banco principal (onde estão a conta corrente e o cartão). Os demais podem entrar no Patrimônio como itens manuais.

**Testar sem dados reais (opcional):** a Pluggy tem um banco de testes, o **Pluggy Bank** (sandbox), com usuário `user-ok`, senha `password-ok` e token MFA `123456`. Os conectores sandbox só aparecem quando habilitados (`includeSandbox`). Veja o [guia de sandbox](https://docs.pluggy.ai/docs/environments-and-configurations).

> Se você revogar o consentimento no Meu Pluggy ou ele expirar, o item para de trazer dados. Renove a autorização e, se o Item ID mudar, atualize `PLUGGY_ITEM_ID` na Vercel e faça **Redeploy**.

---

### 6. Vercel: publicar o app

1. Crie uma conta em [vercel.com](https://vercel.com) **entrando com o GitHub**.
2. Clique em **Add New… → Project** e importe o seu repositório `hey-piper`. Se ele não aparecer, clique em **Adjust GitHub App Permissions** e libere o acesso.
3. Na tela de configuração:
   - **Framework Preset**: `Vite` (normalmente detectado sozinho). Os comandos de build já estão no `vercel.json`, então não mude nada.
   - Abra **Environment Variables**. Copie **todo** o conteúdo do seu `.env` e cole no primeiro campo (**Key**): a Vercel reconhece o formato e cria todas as variáveis de uma vez. Confira se os valores entraram e apague as linhas vazias (variáveis que você não vai usar).
   - Se preferir, adicione uma a uma: o nome em **Key** (ex.: `DATABASE_URL`) e o valor em **Value**.
4. Clique em **Deploy** e aguarde 1–2 minutos.
5. Abra a URL gerada (ex.: `https://hey-piper-xxxx.vercel.app`) e faça login com o `APP_PASSWORD`.

Pela linha de comando, a alternativa é:

```bash
npm i -g vercel
vercel login
vercel link                     # associa a pasta a um projeto na Vercel
vercel env add DATABASE_URL     # repita para cada variável (escolha Production)
vercel --prod
```

**Sobre o cron diário:** o `vercel.json` já agenda `GET /api/patrimonio/cron` todo dia às 09:00 UTC (06:00 em Brasília). Ele grava uma foto do patrimônio e roda só no deploy de **produção**. Se você **não** usar a Pluggy, pode remover o bloco `"crons"` do `vercel.json`.

> **Alterou uma variável de ambiente?** Ela só passa a valer no próximo deploy. Vá em **Deployments → ⋯ → Redeploy**.

---

### 7. Primeiro uso

1. **Troque a senha** em **Configurações**.
2. Em **Categorias**, ajuste as categorias padrão. Pode renomear, mudar cor e ícone, e criar novas.
   - Evite **apagar** as categorias padrão: as regras automáticas do File Import apontam para elas (ids 1 a 19). Renomear não tem problema.
3. Em **Orçamento**, defina quanto pretende gastar por categoria e quanto espera receber nas categorias de receita. O total das receitas planejadas é a **renda mensal planejada** usada no Dashboard e no Relatório do Mês.
4. Importe as transações:
   - **File Import**: arraste o extrato ou a fatura (CSV/XLS/XLSX), revise as categorias sugeridas e confirme.
   - **Smart Import (API)**: com a Pluggy configurada, busca os últimos 30 dias do banco para revisão.
5. Em **Patrimônio**, clique em atualizar para gravar a primeira foto. Cadastre também os bens sem API (imóvel, veículo, conta no exterior…).

---

## Rodando localmente (desenvolvimento)

```bash
npm install
cp .env.example .env     # se ainda não criou; preencha com os seus valores
npm i -g vercel
vercel login
vercel link              # uma vez, associa ao projeto da Vercel
npm run dev              # frontend + API em http://localhost:3000
```

O `npm run dev` usa o `vercel dev`, que roda o Vite e as funções da pasta `api/` juntos. Para checar o build de produção: `npm run build`.

> O cookie de sessão é `Secure`. Ele funciona em `localhost`, mas não se você acessar o servidor de dev por um IP da rede local via http.

## Estrutura

```
api/                 # Serverless functions (uma por recurso, com roteamento interno)
  auth/              # login, logout, troca de senha
  transactions/      # CRUD, resumos, tendências, relatório do mês, sugestões
  categories/  budgets/  goals/
  patrimonio/        # snapshots, itens manuais, cron diário
  pluggy/            # candidatos de importação via Open Finance
  health.js
lib/
  db.js              # cliente Postgres (pool de 1 conexão, adequado a serverless)
  auth.js            # sessão, hash de senha, rate limit de login
  ai.js              # Anthropic / OpenAI conforme o nome do modelo
  pluggy.js  patrimonio.js
src/                 # Frontend React
schema.sql           # Tabelas + categorias padrão
vercel.json          # build, rotas, timeout das funções e cron
```

> O plano Hobby da Vercel permite no máximo **12 Serverless Functions** por deploy, e o projeto já usa as 12. Para adicionar endpoints, crie rotas dentro dos handlers existentes (`_handler.js`) em vez de novos arquivos em `api/`.

Detalhes do modelo de dados:

- As datas são guardadas como texto `YYYY-MM-DD` no fuso `America/Sao_Paulo`, para evitar deslocamentos de dia por timezone.
- **Reembolso**: uma receita pode "descontar" uma categoria de despesa (ex.: reembolso do plano de saúde abate Saúde).
- **Transferência** (`is_transfer`): dinheiro que muda de lugar sem ser consumido (ex.: aporte em investimento). Sai do saldo, mas não conta como gasto.
- **Extraordinária** (`is_extraordinary`): despesa pontual, excluída do ritmo e da projeção do mês.

## Solução de problemas

| Sintoma | Causa provável |
|---|---|
| "Senha incorreta" no primeiro login | `APP_PASSWORD` não definida ou definida depois do deploy (faça **Redeploy**) |
| Erro 500 em tudo / "SESSION_SECRET não configurada" nos logs | falta `SESSION_SECRET` na Vercel |
| Timeout ou erro de conexão com o banco | `DATABASE_URL` com a porta 5432 (use o pooler **6543**), senha errada ou projeto Supabase **pausado** (reative no painel) |
| `relation "categories" does not exist` | o `schema.sql` não foi executado no Supabase |
| File Import não categoriza / relatório falha | `ANTHROPIC_API_KEY` ausente ou sem créditos |
| Smart Import (API) / Patrimônio com erro | variáveis `PLUGGY_*` ausentes, ou consentimento do item expirado |
| Cron retorna 401 | `CRON_SECRET` ausente ou alterado sem redeploy |

Para ver os logs: Vercel → seu projeto → **Logs**.

## Segurança e privacidade

- Seus dados ficam **só** no seu Supabase. Este repositório não coleta nem envia nada para terceiros, exceto:
  - as **descrições das transações** enviadas à Anthropic/OpenAI para categorização no File Import;
  - os **totais por categoria** enviados para gerar o Relatório do Mês.
- Segredos ficam apenas nas variáveis de ambiente (Vercel e `.env` local), nunca no código.
- Ative a autenticação em dois fatores no GitHub, Supabase, Vercel e Pluggy. Quem acessa essas contas acessa os seus dados.

## Licença

[MIT](LICENSE)
