-- Execute no SQL Editor do Supabase (https://supabase.com/dashboard > seu projeto > SQL Editor)

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
  color TEXT NOT NULL DEFAULT '#6366f1',
  icon TEXT NOT NULL DEFAULT '💰',
  budget_limit NUMERIC(12,2) DEFAULT NULL,
  is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
  offsets_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  offset_description_filter TEXT DEFAULT NULL,
  created_at TEXT DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  date TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  notes TEXT DEFAULT '',
  source TEXT DEFAULT NULL,
  ignored INTEGER DEFAULT 0,
  is_offset INTEGER DEFAULT NULL,
  is_extraordinary BOOLEAN NOT NULL DEFAULT FALSE,
  -- Dinheiro que mudou de forma (conta -> investimento) mas não foi consumido: sai do
  -- caixa (conta pro Saldo) mas não conta como gasto real (fora de Despesas, Ritmo do
  -- Mês, Comprometimento da Renda). Ex.: aporte em investimentos a partir de um bônus.
  is_transfer BOOLEAN NOT NULL DEFAULT FALSE,
  offsets_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  import_key TEXT DEFAULT NULL,
  pluggy_transaction_id TEXT DEFAULT NULL,
  created_at TEXT DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE INDEX IF NOT EXISTS idx_transactions_import_key ON transactions(import_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_pluggy_id ON transactions(pluggy_transaction_id) WHERE pluggy_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_offsets ON transactions(offsets_category_id) WHERE offsets_category_id IS NOT NULL;

-- Índice trigram para as buscas por similaridade de descrição
-- (/transactions/similar e /transactions/category-suggestions usam LIKE '%...%')
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_transactions_desc_trgm ON transactions USING gin (LOWER(description) gin_trgm_ops);

CREATE TABLE IF NOT EXISTS savings_goals (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  target_amount NUMERIC(12,2) NOT NULL,
  current_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  deadline TEXT,
  color TEXT NOT NULL DEFAULT '#10b981',
  icon TEXT NOT NULL DEFAULT '🎯',
  created_at TEXT DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS monthly_budgets (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  limit_amount NUMERIC(12,2) NOT NULL,
  UNIQUE(category_id, year, month)
);

CREATE TABLE IF NOT EXISTS monthly_reports (
  id SERIAL PRIMARY KEY,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  content TEXT NOT NULL,
  model TEXT,
  created_at TEXT DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE(year, month)
);

CREATE TABLE IF NOT EXISTS rejected_imports (
  key TEXT PRIMARY KEY,
  created_at TEXT DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

-- Snapshots de patrimônio líquido. A Pluggy só devolve saldo/investimento no
-- valor atual (ponto no tempo), sem histórico — então gravamos uma foto por dia
-- (uma linha por `date`, upsert) para montar a curva de evolução daqui pra frente.
-- `dividas` é positivo (soma das faturas de cartão em aberto); patrimonio = contas
-- + investimentos - dividas. `detalhes` guarda a composição (contas/investimentos)
-- da foto, para o detalhamento na página.
CREATE TABLE IF NOT EXISTS patrimonio_snapshots (
  id SERIAL PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  contas NUMERIC(14,2) NOT NULL DEFAULT 0,
  investimentos NUMERIC(14,2) NOT NULL DEFAULT 0,
  manuais NUMERIC(14,2) NOT NULL DEFAULT 0,
  dividas NUMERIC(14,2) NOT NULL DEFAULT 0,
  patrimonio NUMERIC(14,2) NOT NULL,
  detalhes JSONB,
  created_at TEXT DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

-- Bens/dívidas sem API (conta em moeda estrangeira, imóvel, veículo, etc.). O usuário
-- informa o valor em BRL e atualiza quando quiser; entra na soma do patrimônio (valor
-- positivo soma, negativo — ex. financiamento — subtrai) em cada snapshot.
CREATE TABLE IF NOT EXISTS patrimonio_manual (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'Outro',
  valor NUMERIC(14,2) NOT NULL DEFAULT 0,
  incluir_investimentos BOOLEAN NOT NULL DEFAULT false,
  updated_at TEXT DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

-- Config key-value simples (ex: senha de acesso alterada pelo usuário)
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Rate limiting de login por IP (ver lib/auth.js). Uma linha por IP; zerada no
-- login bem-sucedido, incrementada a cada falha, com bloqueio temporário após
-- MAX_ATTEMPTS falhas dentro de WINDOW_MS.
CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  first_failure_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ
);

-- Categorias padrão (só insere se a tabela estiver vazia). Os ids são fixos porque
-- as regras de palavra-chave do Smart Import (KEYWORD_RULES em src/pages/SmartImport.jsx)
-- referenciam categorias por id — não altere a numeração.
INSERT INTO categories (id, name, type, color, icon, budget_limit)
SELECT * FROM (VALUES
  (1,  'Salário',                 'income',  '#10b981', '💼', NULL::numeric),
  (2,  'Freelance',               'income',  '#06b6d4', '💻', NULL),
  (3,  'Outros Rendimentos',      'income',  '#8b5cf6', '➕', NULL),
  (4,  'Moradia',                 'expense', '#ef4444', '🏠', NULL),
  (5,  'Alimentação',             'expense', '#f97316', '🍽️', NULL),
  (6,  'Transporte',              'expense', '#eab308', '🚗', NULL),
  (7,  'Saúde',                   'expense', '#ec4899', '🩺', NULL),
  (8,  'Educação',                'expense', '#6366f1', '📚', NULL),
  (9,  'Lazer',                   'expense', '#14b8a6', '🎮', NULL),
  (10, 'Vestuário',               'expense', '#f43f5e', '👕', NULL),
  (11, 'Assinaturas',             'expense', '#a855f7', '📱', NULL),
  (12, 'Outros',                  'expense', '#64748b', '📦', NULL),
  (13, 'Reembolso',               'income',  '#22c55e', '💊', NULL),
  (14, 'Compras',                 'expense', '#d946ef', '🛍️', NULL),
  (15, 'IOF/Juros',               'expense', '#b91c1c', '💸', NULL),
  (16, 'Resgate Investimentos',   'income',  '#0ea5e9', '💹', NULL),
  (17, 'Financiamento',           'expense', '#7c3aed', '🏦', NULL),
  (18, 'Aplicação Investimentos', 'expense', '#0891b2', '💰', NULL),
  (19, 'Farmácia',                'expense', '#db2777', '💊', NULL)
) AS v(id, name, type, color, icon, budget_limit)
WHERE NOT EXISTS (SELECT 1 FROM categories LIMIT 1);

-- Como os ids acima foram inseridos explicitamente, avança a sequence para que novas
-- categorias criadas pelo app comecem a partir do 20.
SELECT setval(pg_get_serial_sequence('categories', 'id'), GREATEST((SELECT MAX(id) FROM categories), 1));
