import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
// xlsx (~400 kB) and papaparse are loaded on demand when a file is actually
// parsed, keeping them out of this page's initial chunk.
const loadXlsx = () => import('xlsx');
const loadPapa = () => import('papaparse').then((m) => m.default ?? m);
import {
  Upload, X, Sparkles, Loader2, AlertCircle, CheckCircle,
  ChevronLeft, ChevronRight, Trash2, ArrowUpDown, Pencil,
} from 'lucide-react';
import { api } from '../api.js';

// ─── Constants ───────────────────────────────────────────────────────────────

// Offline fallback only — the real category list always comes from /api/categories
// (cached in api.js). This snapshot is used solely when that request fails, so an
// import can still proceed; ids/names here may lag behind the database.
const CATEGORIES = [
  { id: 5,  type: 'expense', icon: '🍽️', name: 'Alimentação' },
  { id: 18, type: 'expense', icon: '💰', name: 'Aplicação Investimentos' },
  { id: 11, type: 'expense', icon: '📱', name: 'Assinaturas' },
  { id: 14, type: 'expense', icon: '🛍️', name: 'Compras' },
  { id: 8,  type: 'expense', icon: '📚', name: 'Educação' },
  { id: 19, type: 'expense', icon: '🏥', name: 'Farmácia' },
  { id: 17, type: 'expense', icon: '🏠', name: 'Financiamento' },
  { id: 15, type: 'expense', icon: '💸', name: 'IOF/Juros' },
  { id: 9,  type: 'expense', icon: '🎮', name: 'Lazer' },
  { id: 4,  type: 'expense', icon: '🏡', name: 'Moradia' },
  { id: 12, type: 'expense', icon: '📦', name: 'Outros' },
  { id: 7,  type: 'expense', icon: '🩺', name: 'Saúde' },
  { id: 6,  type: 'expense', icon: '🚗', name: 'Transporte' },
  { id: 10, type: 'expense', icon: '👕', name: 'Vestuário' },
  { id: 3,  type: 'income',  icon: '💰', name: 'Outros Rendimentos' },
  { id: 13, type: 'income',  icon: '💊', name: 'Reembolso' },
  { id: 16, type: 'income',  icon: '💹', name: 'Resgate Investimentos' },
  { id: 1,  type: 'income',  icon: '💼', name: 'Salário' },
];

// Fallback "Outros"-style category for a type, resolved by name against the live
// list (ids are not assumed): used when neither keywords, history nor AI produced
// a valid category.
function fallbackCategoryId(catById, type) {
  const cats = Object.values(catById);
  const byName = cats.find((c) => c.type === type && /outros/i.test(c.name));
  return byName ? byName.id : null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

const BRL_FMT = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
function fmtCurrency(n) {
  return BRL_FMT.format(n);
}

// Rows whose description marks them as non-transactions (bank statements)
const SKIP_DESC = /^\s*(saldo\s+(anterior|total|disponível|do\s+dia)|lançamentos\s+futuros|saídas\s+futuras|entradas\s+futuras|lancamentos\s+futuros|saidas\s+futuras)\s*$/i;

// Credit card: descriptions that are never real purchase transactions
const SKIP_CC = /pagamento\s+(efetuado|recebido|da\s+fatura)|estorno\s+de\s+pagamento|limite\s+de\s+cr[eé]dito|saldo\s+anterior/i;

const MONTH_PT = {
  janeiro:1, fevereiro:2, março:3, abril:4, maio:5, junho:6,
  julho:7, agosto:8, setembro:9, outubro:10, novembro:11, dezembro:12,
};

// Detect credit card fatura month — looks for a known month name near a 4-digit year.
// Strategy: first pass prefers cells that also mention "fatura"; second pass accepts any cell.
// This handles Itaú-style files where the month appears in a separate cell from "Fatura".
function detectFaturaMonth(rows) {
  const monthNames = Object.keys(MONTH_PT).join('|');
  const re = new RegExp(`(${monthNames})[^\\d]*(\\d{4})`, 'i');
  const header = rows.slice(0, 30);

  function tryMatch(cell) {
    const s = String(cell ?? '').trim();
    const m = s.match(re);
    if (!m) return null;
    let month = MONTH_PT[m[1].toLowerCase()];
    let year  = parseInt(m[2], 10);
    if (!month || year <= 2000) return null;
    // Itaú fatura: due month is always 1 month after the spending month.
    // "Fatura Agosto" → July expenses; "Fatura Julho" → June expenses.
    if (/aberta|paga/i.test(s)) { month -= 1; if (month < 1) { month = 12; year -= 1; } }
    return `${year}-${String(month).padStart(2, '0')}-01`;
  }

  // Only match cells that explicitly mention "fatura" — avoids false positives on bank statements.
  for (const row of header) {
    for (const cell of row) {
      if (!/fatura/i.test(String(cell ?? ''))) continue;
      const result = tryMatch(cell);
      if (result) return result;
    }
  }

  return null;
}

function parseDate(raw) {
  if (!raw && raw !== 0) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD/MM/YYYY or DD/MM/YY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yr}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }
  // Excel serial number (dates between ~1990 and ~2050)
  const serial = parseFloat(s);
  if (!isNaN(serial) && serial > 32874 && serial < 73050) {
    const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    return date.toISOString().slice(0, 10);
  }
  return null;
}

function parseAmount(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = parseFloat(String(raw).replace(/\s/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.'));
  return isNaN(n) ? null : n; // keep sign
}

// Header keywords for each column type
const HDR_DATE  = /^(data|date|dt\.?|data\s*(mov|lançamento)?)/i;
const HDR_VALUE = /^(valor|value|vlr\.?|montante|crédito|débito|valor\s*r\$|valor\s*\(r\$\))/i;
const HDR_DESC  = /^(descrição|descri|lançamento|histórico|hist\.?|memo|narração|estabelecimento)/i;
const HDR_SKIP  = /^(saldo|balance|ag\.?\/origem|agência|origem|branch)/i;

function detectColumns(rows, knownParcelCol = -1) {
  const ncols = Math.max(...rows.map((r) => r.length), 0);
  let dateCol = -1, descCol = -1, valueCol = -1;

  // 1. Try to find a header row in first 15 rows (Itaú and similar have summary rows before headers)
  for (let r = 0; r < Math.min(15, rows.length); r++) {
    const row = rows[r];
    let foundDate = -1, foundValue = -1, foundDesc = -1;
    row.forEach((cell, c) => {
      const s = String(cell ?? '').trim();
      if (foundDate  === -1 && HDR_DATE.test(s))  foundDate  = c;
      if (foundValue === -1 && HDR_VALUE.test(s)) foundValue = c;
      // Don't use the parcelamento column as the description column
      if (foundDesc  === -1 && c !== knownParcelCol && HDR_DESC.test(s))  foundDesc  = c;
    });
    if (foundDate !== -1 && foundValue !== -1) {
      // Validate that the detected value column actually contains numbers in data rows.
      // Itaú format has a separate "R$" prefix column beside the numeric column,
      // so the "Valor" header may point to the "R$" column, not the numbers.
      const dataRows = rows.slice(r + 1, r + 10);
      const hasNums = dataRows.some((dr) => parseAmount(dr[foundValue]) !== null);
      if (!hasNums) {
        // Check the next column — it might hold the actual numbers (Itaú pattern)
        const nextCol = foundValue + 1;
        const nextHasNums = dataRows.some((dr) => parseAmount(dr[nextCol]) !== null);
        if (nextHasNums) foundValue = nextCol;
        // If neither has numbers, skip this header row and keep scanning
        else continue;
      }
      dateCol = foundDate; valueCol = foundValue;
      if (foundDesc !== -1) descCol = foundDesc;
      break;
    }
  }

  // 2. Heuristic fallback for missing columns
  const sample = rows.slice(0, 25).filter((r) => r.some((c) => c !== '' && c !== null));

  if (dateCol === -1) {
    for (let c = 0; c < ncols; c++) {
      const hits = sample.filter((r) => parseDate(r[c])).length;
      if (hits >= Math.max(2, sample.length * 0.3)) { dateCol = c; break; }
    }
  }

  if (valueCol === -1) {
    // Prefer column with BOTH positive and negative values (transaction column)
    // over saldo column (which tends to be monotonic or one-sided)
    let bestScore = -1;
    for (let c = 0; c < ncols; c++) {
      if (c === dateCol) continue;
      // Skip columns whose header indicates saldo/branch
      const headerCell = String(rows[0]?.[c] ?? '');
      if (HDR_SKIP.test(headerCell)) continue;
      const nums = sample
        .map((r) => parseFloat(String(r[c] ?? '').replace(',', '.')))
        .filter((n) => !isNaN(n) && n !== 0);
      if (nums.length < 2) continue;
      const hasPos = nums.some((n) => n > 0);
      const hasNeg = nums.some((n) => n < 0);
      // Mixed sign = +10 bonus (hallmark of a transaction value column)
      const score = (hasPos && hasNeg ? 10 : 0) + nums.length;
      if (score > bestScore) { bestScore = score; valueCol = c; }
    }
  }

  if (descCol === -1) {
    // Column with longest average text that isn't date, value, or the parcel column
    let best = 0;
    for (let c = 0; c < ncols; c++) {
      if (c === dateCol || c === valueCol || c === knownParcelCol) continue;
      const texts = sample.map((r) => String(r[c] ?? '').trim()).filter((s) => s.length > 1);
      const avg = texts.reduce((s, t) => s + t.length, 0) / (texts.length || 1);
      if (avg > best) { best = avg; descCol = c; }
    }
  }

  return { dateCol, descCol, valueCol };
}

const HDR_PARCEL = /^(parcelamento|parcela|instalment)/i;

function rowsToTransactions(rows, dateCol, descCol, valueCol, opts = {}) {
  const { faturaDate = null, parcelCol = -1 } = opts;
  const isFatura = !!faturaDate;
  const out = [];

  rows.forEach((row) => {
    const rawVal = row[valueCol];
    const amount = parseAmount(rawVal);
    const desc   = descCol !== -1 ? String(row[descCol] ?? '').trim() : '';

    if (amount === null || amount === 0) return;
    if (SKIP_CC.test(desc)) return; // always skip payment rows regardless of file type

    if (isFatura) {
      if (!desc) return;
    } else {
      if (SKIP_DESC.test(desc)) return;
    }

    // For installment transactions (parcelamento column is filled), use the billing month
    // as the date instead of the original purchase date — the installment belongs to the
    // month it appears on the bill, not when the original purchase was made.
    // Exception: the 1st installment's row date already falls within the current invoice's
    // billing cycle (it's when the purchase happened), so keep the real day for it.
    // Non-installment transactions always keep their original row date.
    const parcelStr = parcelCol !== -1 ? String(row[parcelCol] ?? '').trim() : '';
    const hasParcel = parcelStr.length > 0;
    const parcelMatch = parcelStr.match(/(\d+)\s*(?:de|\/)\s*(\d+)/i);
    const isFirstInstallment = parcelMatch ? parseInt(parcelMatch[1], 10) === 1 : false;
    const date = (isFatura && hasParcel && !isFirstInstallment) ? faturaDate : parseDate(row[dateCol]);
    if (!date) return;

    // Append installment info to description if available
    const fullDesc = parcelStr ? `${desc} (${parcelStr})` : desc;

    const type = isFatura
      ? (amount < 0 ? 'income' : 'expense')   // fatura: positive=expense, negative=cashback/credit
      : (amount < 0 ? 'expense' : 'income');  // bank statement: negative=expense, positive=income

    const absAmount = Math.abs(amount);
    // import_key uses the ORIGINAL file date (before any user edits) so dedup survives date changes
    const importKey = `${parseDate(row[dateCol]) || date}|${(fullDesc || 'Sem descrição').trim().toLowerCase()}|${Math.round(absAmount * 100)}`;
    out.push({
      date,
      description: fullDesc || 'Sem descrição',
      amount: absAmount,
      type,
      source: isFatura ? 'credit_card' : 'bank_account',
      notes: '',
      import_key: importKey,
    });
  });
  return out;
}

// Extract pre-structured transactions from xlsx/xls
async function extractFromXlsx(file, faturaMonthOverride = null) {
  const [buf, { read: xlsxRead, utils: xlsxUtils }] = await Promise.all([file.arrayBuffer(), loadXlsx()]);
  const wb = xlsxRead(buf, { type: 'array', cellDates: false });
  const all = [];
  let detectedFaturaDate = null;

  wb.SheetNames.forEach((sName) => {
    const ws = wb.Sheets[sName];
    const rows = xlsxUtils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    if (!rows.length) return;

    // Use manual override if provided, otherwise auto-detect from file content
    const faturaDate = faturaMonthOverride
      ? `${faturaMonthOverride}-01`
      : detectFaturaMonth(rows);

    if (faturaDate && !detectedFaturaDate) detectedFaturaDate = faturaDate;

    // Find parcelamento column FIRST so detectColumns can exclude it from desc detection
    let parcelCol = -1;
    if (faturaDate) {
      const hRow = rows.find((r) => r.some((c) => HDR_PARCEL.test(String(c ?? ''))));
      if (hRow) parcelCol = hRow.findIndex((c) => HDR_PARCEL.test(String(c ?? '')));
    }

    const { dateCol, descCol, valueCol } = detectColumns(rows, parcelCol);
    if (dateCol === -1 || valueCol === -1) return;

    all.push(...rowsToTransactions(rows, dateCol, descCol, valueCol, { faturaDate, parcelCol }));
  });

  return { transactions: all, detectedFaturaDate };
}

// Extract pre-structured transactions from CSV
async function extractFromCsv(file, faturaMonthOverride = null) {
  const Papa = await loadPapa();
  return new Promise((resolve) => {
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: ({ data: rows }) => {
        if (!rows.length) return resolve({ transactions: [], detectedFaturaDate: null });
        const faturaDate = faturaMonthOverride
          ? `${faturaMonthOverride}-01`
          : detectFaturaMonth(rows);
        let parcelCol = -1;
        if (faturaDate) {
          const hRow = rows.find((r) => r.some((c) => HDR_PARCEL.test(String(c ?? ''))));
          if (hRow) parcelCol = hRow.findIndex((c) => HDR_PARCEL.test(String(c ?? '')));
        }
        const { dateCol, descCol, valueCol } = detectColumns(rows, parcelCol);
        if (dateCol === -1 || valueCol === -1) return resolve({ transactions: [], detectedFaturaDate: null });
        resolve({
          transactions: rowsToTransactions(rows, dateCol, descCol, valueCol, { faturaDate, parcelCol }),
          detectedFaturaDate: faturaDate,
        });
      },
    });
  });
}

async function extractTransactions(file, faturaMonthOverride = null) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'csv') return extractFromCsv(file, faturaMonthOverride);
  return extractFromXlsx(file, faturaMonthOverride);
}

// Normalize a transaction description for fuzzy matching:
// removes trailing date suffixes (12/06), long numeric IDs, and extra spaces
function normalizeDesc(desc) {
  return String(desc)
    .trim()
    .toLowerCase()
    .replace(/\s*\(parcela\s+\d+\s+de\s+\d+\)\s*$/i, '') // "(Parcela 5 de 10)" suffix
    .replace(/\s*\d{1,2}\/\d{2}(\/\d{2,4})?\s*$/, '')    // trailing date: "26/06" or "26/06/2026"
    .replace(/\s+\d{6,}\s*/g, ' ')                        // long numeric IDs inline
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Build category memory: normalized description → { category_id, count, label }
async function buildCategoryMemory() {
  try {
    const data = await api.getTransactions({ limit: 2000 });
    const txs = Array.isArray(data) ? data : (data.transactions ?? []);

    const map = {};
    txs.forEach((t) => {
      if (!t.description || !t.category_id) return;
      const key = normalizeDesc(t.description);
      if (!key) return;
      if (!map[key]) map[key] = { category_id: t.category_id, count: 0, label: t.description };
      map[key].count++;
    });

    return map; // return the full map keyed by normalized description
  } catch {
    return {};
  }
}

// Deterministic keyword rules — higher priority than history
// Order matters: first match wins — put most specific first.
// NOTE: patterns for user-created custom categories (Mercado, Ifood, Cuidados Pessoais, etc.)
// are intentionally absent — history matching handles those correctly.
const KEYWORD_RULES = [
  // Transporte (6)
  { cat: 6, words: [
      'uber',          // Uber *Trip, Uber *One, Uber Uber
      'dl*uber', 'dl *uber', 'di*uber', 'di *uber',  // gateway Uber no cartão
      '99app', '99pop', '99taxi', '99 taxi', 'cabify',
      'tagitau',       // TAG-IT-AU = pedágio Itaú
      'sem parar', 'veloe', 'conectcar', 'autopass',
      'pedagio', 'pedágio', 'rodovia',
      'estacionamento', 'estacionam', 'estaci',
      'allpark', 'parking',
      'combustivel', 'combustível', 'gasolina', 'etanol', 'alcool comb',
      'posto ', // posto de gasolina
      'ipva', 'detran', 'cnh', 'autoescola', 'auto escola',
      'mottu', 'tembici', 'bike itau', 'yellow ',
  ] },

  // Farmácia (19) — antes de Saúde para evitar overlap
  { cat: 19, words: [
      'drogaria', 'farmacia', 'farmácia', 'ultrafarma',
      'droga raia', 'drogaraia', 'drogasil', 'rd saude', // RD = Raia Drogasil
      'pacheco', 'pague menos', 'panvel', 'medicar',
      'manipulacao', 'manipulação', 'farma ',
      'rappi*drogaria', 'rappi*farma',
  ] },

  // Saúde (7)
  { cat: 7, words: [
      'saude', 'saúde', 'clinica', 'clínica', 'medico', 'médico',
      'hospital', 'laboratorio', 'laboratório', 'lab ',
      'exame', 'consulta', 'ortopedia', 'odonto', 'dentista',
      'unimed', 'amil', 'hapvida', 'sulamerica', 'notredame',
      'plano saude', 'plano de saude', 'care plus', 'bradesco saude',
      'fisioterapia', 'psicolog', 'nutricion', 'nutricao', 'nutricão',
      'terapia', 'terapi', 'oftalmolog', 'dermatolog', 'cardiolog',
      'pediatr', 'ginecolog', 'radiolog', 'audiolog', 'audio.com',
      'fleury', 'einstein', 'sirio', 'sao luiz', 'santa catarina',
  ] },

  // Educação (8)
  { cat: 8, words: [
      'escola', 'colegio', 'colégio', 'faculdade', 'universidade',
      'bercario', 'berçário', 'berçario', 'creche', 'jardim de infancia',
      'ensino', 'educacao', 'educação',
      'livraria', 'livros', 'material escolar',
      'curso de', 'aula de', 'aula ', 'curso ',
      'coc ', 'objetivo ', 'anglo ', 'etapa ', 'maple bear',
  ] },

  // Vestuário (10)
  { cat: 10, words: [
      'inditex', 'pull&bear', 'bershka', 'stradivarius', 'massimo dutti',
      'lupo ', 'cueca', 'meia ', 'calcinha', 'lingerie',
      'tenis ', 'tênis ', 'sapato', 'bota ', 'sandalia', 'sandália', 'chinelo',
      'roupa', 'camisa', 'camiseta', 'calca ', 'jeans', 'vestido', 'saia ',
  ] },

  // Compras (14) — marketplaces e lojas
  { cat: 14, words: [
      'amazon', 'mercadolivre', 'mercado livre', 'mercadopago', 'mktplc',
      'shopee', 'shein', 'aliexpress',
      'magazine luiza', 'magalu', 'americanas', 'casas bahia', 'submarino',
      'leroy merlin', 'tok&stok', 'ikea',
      'renner ', 'riachuelo', 'c&a ', 'marisa ', 'zara', 'hering',
      'reserva ', 'osklen', 'aramis',
      'pbkids', 'pb kids', 'ri happy', 'rihappy', 'toymania', 'baby store', 'pequeno principe',
      'magic kids', 'cuca toys', ' toys', 'toy ', 'brinquedo',
      'calcado', 'calçado',
      'eletronico', 'eletrônico', 'informatica', 'informática',
      'notebook', 'tablet', 'eletrodomestico',
  ] },

  // Alimentação (5) — restaurantes e delivery
  { cat: 5, words: [
      'restaurante', 'lanchonete', 'lanchone', 'pizzaria', 'hamburgueria', 'hamburguer', 'burguer',
      'sushi', 'japonese', 'churrascaria', 'padaria', 'bakery', 'lanches',
      'cafe ', 'café ', 'cafeteria', 'boteco',
      'bar e', 'bar do', 'bar da', 'bar rest',
      'rappi', 'james delivery',
      'açougue', 'acougue', 'peixaria',
      'quitanda', 'sorveteria', 'sorvete', 'gelato', 'acai ', 'açaí ',
      'confeitaria', 'doceria', 'rotisseria', 'bistrô', 'bistro',
      'snack', 'kitchen',
      'alimentacao', 'alimentação', 'comida', 'food ',
  ] },

  // Assinaturas (11) — streaming, software, telecom, utilities
  { cat: 11, words: [
      'netflix', 'spotify', 'disney', 'hbo', 'prime video', 'amazon prime',
      'youtube premium', 'apple tv', 'apple one', 'apple music', 'apple.com',
      'globoplay', 'paramount', 'deezer', 'tidal', 'crunchyroll', 'twitch',
      'xbox game pass', 'playstation plus', 'nintendo',
      'icloud', 'google one', 'dropbox',
      'adobe ', 'microsoft 365', 'office 365', 'ppro ', // ppro = gateway Microsoft
      'ebn ', // gateway Spotify no cartão
      'canva ', 'chatgpt', 'anthropic', 'openai', 'duolingo',
      'claro ', 'tim ', ' oi ', 'sky ',
      'vivo', 'int /vivo', // Vivo telefonia
      'enel ', 'sabesp', 'cpfl ', 'comgas', 'gas encanado',
      'light ', 'embratel', 'net serv', 'banda larga',
  ] },

  // Lazer (9) — entretenimento, esporte
  { cat: 9, words: [
      'cinema', 'teatro', 'show ', 'ingresso', 'ticketmaster', 'sympla', 'bilheteria',
      'steam ', 'epic games', 'ubisoft',
      'parque ', 'clube ',
      'academia', 'smartfit', 'smart fit', 'bluefit', 'bodytech', 'crossfit',
      'natacao', 'natação', 'pilates', 'yoga ',
      'estetica', 'estética', 'salao', 'salão', 'barbearia',
      'manicure', 'pedicure', 'depilacao', 'depilação', 'spa ', 'massagem',
  ] },

  // Moradia (4)
  { cat: 4, words: [
      'aluguel', 'condominio', 'condomínio', 'iptu',
      'administradora', 'imobiliaria', 'imobiliária', 'sindico', 'síndico',
  ] },

  // Financiamento (17)
  { cat: 17, words: ['financiamento', 'financ imobiliario', 'financ imob', 'caixa federal', 'credito imob'] },

  // IOF/Juros (15)
  { cat: 15, words: ['iof', 'juros ', 'encargo', ' mora '] },

  // Resgates (16) — deve vir antes de Aplicação para 'resgate cdb' não bater em 'cdb '
  { cat: 16, words: ['resgate cdb', 'resgate lci', 'resgate lca', 'resgate lft', 'resgate fundo', 'resgate teso'] },

  // Outros Rendimentos (3) — rendimentos automáticos de aplicações
  { cat: 3, words: ['rend pago aplic', 'rendimento aplic', 'rend cdb', 'rend lci', 'rend lca', 'juros sobre aplic'] },

  // Aplicação Investimentos (18)
  { cat: 18, words: [
      'aplicacao', 'aplicação', 'investimento', 'tesouro direto', 'tesouro nacional',
      'cdb ', 'lci ', 'lca ', 'lft ', 'ntnb',
      'previdencia', 'previdência', 'pgbl', 'vgbl',
      'xp investimentos', 'btg pactual', 'nuinvest', 'inter invest',
      'rico ', 'clear corretora',
  ] },
];

// Dynamic patterns keyed by what the user's category NAME contains.
// Used to match common Brazilian merchants against user-created categories.
const DYNAMIC_PATTERNS = [
  {
    catNames: ['mercado', 'supermercado', 'grocery'],
    words: [
      'supermercado', 'hipermercado', 'hiper ', 'hiper*', 'hypermarket',
      'carrefour', 'extra ', 'pao de acucar', 'pão de açúcar', 'grupo pao',
      'assai', 'atacadao', 'atacadão', 'makro', 'sam\'s club', 'costco',
      'hortifruti', 'hortifru', 'verdureiro', 'quitanda', 'feira ',
      'prezunic', 'sao chico', 'send', 'bem barato', 'dia super', 'dia %',
    ],
  },
  {
    catNames: ['ifood', 'ifd', 'delivery'],
    words: [
      'ifood', 'ifd ', '*ifd', 'dl*ifd', 'if*', 'i food',
    ],
  },
];

function matchFromKeywords(desc, allCats = null) {
  const norm = normalizeDesc(desc).toLowerCase();
  for (const rule of KEYWORD_RULES) {
    if (rule.words.some((w) => norm.includes(w))) return rule.cat;
  }
  // Dynamic matching against user-created category names
  if (allCats && allCats.length) {
    for (const pattern of DYNAMIC_PATTERNS) {
      if (pattern.words.some((w) => norm.includes(normalizeDesc(w).toLowerCase()))) {
        const cat = allCats.find((c) =>
          pattern.catNames.some((n) => c.name.toLowerCase().includes(n))
        );
        if (cat) return cat.id;
      }
    }
  }
  return null;
}

// Match a transaction description against the history map in code (no AI needed).
// Returns category_id if a match is found, null otherwise.
function matchFromHistory(desc, historyMap) {
  const norm = normalizeDesc(desc);
  if (!norm) return null;

  // 1. Exact normalized match
  if (historyMap[norm]) return historyMap[norm].category_id;

  // 2. New description starts with a known history key (e.g. "pix transf fulano" in history,
  //    new desc normalizes to "pix transf fulano" — already caught above, but also catches
  //    cases where history key is longer)
  // 3. History key is contained in the new description or vice versa (substring match)
  let bestMatch = null;
  let bestLen = 0;
  for (const [key, entry] of Object.entries(historyMap)) {
    if (key.length < 4) continue; // ignore very short keys
    if (norm.includes(key) || key.includes(norm)) {
      // prefer the longest matching key to avoid false positives
      if (key.length > bestLen) {
        bestLen = key.length;
        bestMatch = entry.category_id;
      }
    }
  }
  return bestMatch;
}

// Stable part of the categorization prompt — identical across every batch of the
// same import run (categories + rules + user history), so it's sent as a separate
// cacheable content block. Only the transaction list changes per batch.
// Benchmarked against the previous, more verbose prompt on 75 real categorized transactions
// (5 batches of 15 — the typical size that reaches AI after the keyword/history filters):
// ~30% fewer input tokens (827 vs 1186 avg) with no measurable accuracy difference
// (76.0% vs 77.3%, within noise — 4 of 5 batches had identical mismatches).
function buildCategorizationStablePrompt(memory = [], cats = CATEGORIES) {
  const catLine = (c) => `${c.id}=${c.name}`;
  const expenseList = cats.filter((c) => c.type === 'expense').map(catLine).join(',');
  const incomeList = cats.filter((c) => c.type === 'income').map(catLine).join(',');

  const memoryBlock = memory.length > 0
    ? `\nExemplos:${memory.map((m) => `${normalizeDesc(m.label)}=${m.category_id}`).join(';')}`
    : '';

  return `Categorize transações financeiras BR por category_id.
DESPESA:${expenseList}
RECEITA:${incomeList}${memoryBlock}
JSON: {"categories":[{"index":N,"category_id":N}]}`;
}

function buildCategorizationVariablePrompt(transactions) {
  const txList = transactions.map((t, i) =>
    `${i}: [${t.type === 'expense' ? 'DESPESA' : 'RECEITA'}] ${normalizeDesc(t.description)}`
  ).join('\n');
  return `TRANSAÇÕES para categorizar (índice: tipo | descrição normalizada):\n${txList}`;
}

// ─── Step bar ────────────────────────────────────────────────────────────────

function StepBar({ step }) {
  const steps = ['Upload', 'Processar', 'Revisar'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 28 }}>
      {steps.map((label, i) => {
        const idx = i + 1;
        const active = idx === step;
        const done = idx < step;
        return (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', flex: i < steps.length - 1 ? 1 : 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: done || active ? '#6366f1' : '#374151',
                color: done || active ? '#fff' : '#6b7280',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 600,
                border: active && !done ? '2px solid #818cf8' : '2px solid transparent',
                transition: 'all 0.2s',
              }}>
                {done ? '✓' : idx}
              </div>
              <span style={{ fontSize: 11, color: active ? '#a5b4fc' : done ? '#6366f1' : '#6b7280', fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ flex: 1, height: 2, margin: '0 8px', marginBottom: 18, background: done ? '#6366f1' : '#374151', transition: 'background 0.2s' }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1: Upload ───────────────────────────────────────────────────────────

function StepUpload({ files, setFiles, dateFrom, setDateFrom, dateTo, setDateTo, faturaMonth, setFaturaMonth, onNext }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const addFiles = useCallback(async (newFiles) => {
    const toAdd = Array.from(newFiles).filter((f) => {
      const ext = f.name.split('.').pop().toLowerCase();
      return ['xlsx', 'xls', 'csv'].includes(ext);
    });
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name + f.size));
      return [...prev, ...toAdd.filter((f) => !existing.has(f.name + f.size))];
    });
    // Auto-detect fatura month from uploaded files (only if not already set manually)
    for (const f of toAdd) {
      try {
        const ext = f.name.split('.').pop().toLowerCase();
        let rows = null;
        if (ext === 'csv') {
          const Papa = await loadPapa();
          rows = await new Promise((res) => Papa.parse(f, { header: false, skipEmptyLines: true, complete: ({ data }) => res(data) }));
        } else {
          const [buf, { read: xlsxRead, utils: xlsxUtils }] = await Promise.all([f.arrayBuffer(), loadXlsx()]);
          const wb = xlsxRead(new Uint8Array(buf), { type: 'array', cellDates: false });
          const ws = wb.Sheets[wb.SheetNames[0]];
          rows = xlsxUtils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
        }
        const detected = detectFaturaMonth(rows);
        if (detected) {
          setFaturaMonth((prev) => prev || detected.substring(0, 7)); // "YYYY-MM"
          break;
        }
      } catch (_) { /* ignore parse errors during preview */ }
    }
  }, [setFiles, setFaturaMonth]);

  const onDrop = useCallback((e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }, [addFiles]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? '#6366f1' : '#374151'}`,
          borderRadius: 16, padding: '40px 24px', textAlign: 'center', cursor: 'pointer',
          background: dragging ? 'rgba(99,102,241,0.07)' : 'rgba(255,255,255,0.02)',
          transition: 'all 0.2s', userSelect: 'none',
        }}
      >
        <input ref={inputRef} type="file" multiple accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={(e) => addFiles(e.target.files)} />
        <Upload size={36} style={{ color: dragging ? '#818cf8' : '#4b5563', margin: '0 auto 12px' }} />
        <p style={{ color: '#d1d5db', fontWeight: 600, marginBottom: 4 }}>Arraste arquivos aqui ou clique para selecionar</p>
        <p style={{ color: '#6b7280', fontSize: 13 }}>Suporta .xlsx, .xls e .csv, múltiplos arquivos</p>
      </div>

      {files.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {files.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#111827', borderRadius: 12, padding: '10px 14px', border: '1px solid #1f2937' }}>
              <span style={{ fontSize: 20 }}>📄</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ color: '#e5e7eb', fontSize: 14, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</p>
                <p style={{ color: '#6b7280', fontSize: 12, margin: 0 }}>{fmtBytes(f.size)}</p>
              </div>
              <button onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                style={{ color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 8, display: 'flex' }}
                onMouseOver={(e) => e.currentTarget.style.color = '#ef4444'}
                onMouseOut={(e) => e.currentTarget.style.color = '#6b7280'}>
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Date range filter */}
      <div style={{ background: '#111827', borderRadius: 14, padding: '16px 20px', border: '1px solid #1f2937' }}>
        <p style={{ color: '#9ca3af', fontSize: 12, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Filtrar por período <span style={{ color: '#4b5563', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(opcional)</span>
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ color: '#6b7280', fontSize: 13, whiteSpace: 'nowrap' }}>De</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="input" style={{ padding: '5px 10px', fontSize: 13 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ color: '#6b7280', fontSize: 13, whiteSpace: 'nowrap' }}>Até</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="input" style={{ padding: '5px 10px', fontSize: 13 }} />
          </div>
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
              onMouseOver={(e) => e.currentTarget.style.color = '#f87171'}
              onMouseOut={(e) => e.currentTarget.style.color = '#6b7280'}>
              <X size={13} /> Limpar
            </button>
          )}
        </div>
        {(dateFrom || dateTo) && (
          <p style={{ color: '#6366f1', fontSize: 12, margin: '10px 0 0' }}>
            Apenas transações {dateFrom ? `a partir de ${dateFrom}` : ''}{dateFrom && dateTo ? ' ' : ''}{dateTo ? `até ${dateTo}` : ''} serão importadas.
          </p>
        )}
      </div>

      {/* Fatura month override */}
      <div style={{ background: '#111827', borderRadius: 14, padding: '16px 20px', border: '1px solid #1f2937' }}>
        <p style={{ color: '#9ca3af', fontSize: 12, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Mês de referência da fatura <span style={{ color: '#4b5563', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(para faturas de cartão de crédito)</span>
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <input
            type="month"
            value={faturaMonth}
            onChange={(e) => setFaturaMonth(e.target.value)}
            className="input"
            style={{ padding: '5px 10px', fontSize: 13 }}
          />
          {faturaMonth && (
            <button onClick={() => setFaturaMonth('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
              onMouseOver={(e) => e.currentTarget.style.color = '#f87171'}
              onMouseOut={(e) => e.currentTarget.style.color = '#6b7280'}>
              <X size={13} /> Limpar
            </button>
          )}
        </div>
        <p style={{ color: faturaMonth ? '#6366f1' : '#6b7280', fontSize: 12, margin: '10px 0 0' }}>
          {faturaMonth
            ? `✓ Mês detectado: ${faturaMonth}. Parcelas serão contabilizadas neste mês.`
            : 'Será detectado automaticamente pelo cabeçalho do arquivo.'}
        </p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onNext} disabled={files.length === 0} className="btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: files.length === 0 ? 0.4 : 1 }}>
          Próximo <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ─── Step 2: Process ─────────────────────────────────────────────────────────

function StepProcess({ files, dateFrom, dateTo, faturaMonthOverride, onBack, onDone }) {
  const navigate = useNavigate();
  const [running, setRunning]         = useState(false);
  const [error, setError]             = useState(null);
  const [allExistsCount, setAllExistsCount] = useState(0);
  const [pendingResult, setPendingResult] = useState(null);
  const [logs, setLogs]               = useState([]);
  const [allCats, setAllCats]         = useState([]);
  const logRef                        = useRef(null);
  const cancelledRef                  = useRef(false);
  const abortCtrlRef                  = useRef(null);

  useEffect(() => {
    api.getCategories().then((cats) => { if (Array.isArray(cats)) setAllCats(cats); }).catch(() => {});
  }, []);

  function log(icon, text, color = '#9ca3af') {
    const ts = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs((prev) => [...prev, { ts, icon, text, color }]);
    setTimeout(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }); }, 30);
  }

  function stop() {
    cancelledRef.current = true;
    abortCtrlRef.current?.abort();
    setRunning(false);
  }

  function handleBack() {
    stop();
    onBack();
  }

  async function process() {
    cancelledRef.current = false;
    setError(null);
    setLogs([]);
    setPendingResult(null);
    setRunning(true);
    try {
      // Step A: extract
      log('📂', 'Lendo arquivos...');
      const lists = await Promise.all(files.map(async (f) => {
        const { transactions: result, detectedFaturaDate } = await extractTransactions(f, faturaMonthOverride || null);
        const isFatura = result.length > 0 && result[0].source === 'credit_card';
        if (isFatura) {
          if (faturaMonthOverride) {
            log('📅', `Mês da fatura definido manualmente: ${faturaMonthOverride}`, '#a5b4fc');
          } else if (detectedFaturaDate) {
            const [y, m] = detectedFaturaDate.split('-');
            const monthName = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'][parseInt(m,10)-1];
            log('📅', `Mês da fatura detectado automaticamente: ${monthName}/${y}`, '#a5b4fc');
          }
        }
        log('✅', `${f.name}: ${result.length} lançamentos encontrados${isFatura ? ' (fatura cartão)' : ' (extrato)'}`, '#6ee7b7');
        return result;
      }));
      if (cancelledRef.current) return;

      let txList = lists.flat().sort((a, b) => a.date.localeCompare(b.date));

      if (!txList.length) throw new Error('Nenhuma transação encontrada nos arquivos. Verifique se o formato é compatível.');

      // Apply date range filter
      if (dateFrom || dateTo) {
        log('📅', `Filtro de período: ${dateFrom || '…'} → ${dateTo || '…'}`, '#a5b4fc');
        const before = txList.length;
        txList = txList.filter((t) => {
          if (dateFrom && t.date < dateFrom) return false;
          if (dateTo   && t.date > dateTo)   return false;
          return true;
        });
        const removed = before - txList.length;
        log('📅', `${txList.length} no período${removed > 0 ? `, ${removed} fora do range descartad${removed !== 1 ? 'as' : 'a'}` : ''}`, removed > 0 ? '#6ee7b7' : '#9ca3af');
        if (!txList.length) throw new Error('Nenhuma transação no período selecionado. Ajuste o filtro de data.');
      }

      log('📊', `Total a processar: ${txList.length} transações`);

      // Step B: dedup
      log('🔍', 'Verificando duplicatas na base de dados...');
      const months = [...new Set(txList.map((t) => t.date.slice(0, 7)))];
      let existingSet = new Set();
      try {
        const [txResults, importKeysRes, rejectedRes] = await Promise.all([
          Promise.all(months.map((ym) => {
            const [y, m] = ym.split('-');
            return api.getTransactions({ year: y, month: m, limit: 1000, include_ignored: true });
          })),
          api.getImportKeys(months),
          api.getRejectedImports(),
        ]);
        txResults.forEach((res) => {
          const rows = Array.isArray(res) ? res : (res.transactions ?? []);
          rows.forEach((t) => {
            existingSet.add(`${t.date}|${String(t.description).trim().toLowerCase()}|${Math.round(Number(t.amount) * 100)}`);
            if (t.import_key) existingSet.add(t.import_key);
          });
        });
        (importKeysRes.keys ?? []).forEach((k) => existingSet.add(k));
        (rejectedRes.keys ?? []).forEach((k) => existingSet.add(k));
      } catch (_) { log('⚠️', 'Não foi possível verificar duplicatas, prosseguindo sem filtro', '#fcd34d'); }
      if (cancelledRef.current) return;

      const newTx   = txList.filter((t) => !existingSet.has(t.import_key) && !existingSet.has(`${t.date}|${t.description.trim().toLowerCase()}|${Math.round(t.amount * 100)}`));
      const skipped = txList.length - newTx.length;

      if (skipped > 0) log('🔁', `${skipped} transaç${skipped !== 1 ? 'ões' : 'ão'} já existente${skipped !== 1 ? 's' : ''} na base, ignorada${skipped !== 1 ? 's' : ''}`, '#a5b4fc');

      if (!newTx.length) {
        log('✅', 'Todas as transações do arquivo já estão na base. Nada a importar.', '#6ee7b7');
        setAllExistsCount(txList.length);
        setRunning(false);
        return;
      }

      log('🆕', `${newTx.length} transaç${newTx.length !== 1 ? 'ões' : 'ão'} nova${newTx.length !== 1 ? 's' : ''} para categorizar`, '#6ee7b7');

      // Step C: history match
      log('📚', 'Carregando histórico de categorizações...');
      const historyMap = await buildCategoryMemory();
      if (cancelledRef.current) return;
      const historySize = Object.keys(historyMap).length;
      log('📚', `Histórico: ${historySize} padrões de descrição carregados`);

      // Category lookup from the database (the mount-time fetch may have failed or
      // not resolved yet — refetch here; api.js caches it). Hardcoded list is the
      // last-resort fallback so an import still works offline from the API.
      const cats = allCats.length
        ? allCats
        : await api.getCategories().catch(() => CATEGORIES);
      const catById = Object.fromEntries(cats.map((c) => [c.id, c]));

      const afterKeywords = newTx.map((t) => {
        const catId = matchFromKeywords(t.description, cats);
        const valid = catId && catById[catId] && catById[catId].type === t.type;
        return { ...t, category_id: valid ? catId : null, _matched: valid ? 'keyword' : null };
      });

      const withHistory = afterKeywords.map((t) => {
        if (t._matched) return t;
        const catId = matchFromHistory(t.description, historyMap);
        const valid = catId && catById[catId] && catById[catId].type === t.type;
        return { ...t, category_id: valid ? catId : null, _matched: valid ? 'history' : null };
      });

      const fromKeyword = withHistory.filter((t) => t._matched === 'keyword').length;
      const fromHistory = withHistory.filter((t) => t._matched === 'history').length;
      const needsAI     = withHistory.map((t, i) => ({ ...t, _origIdx: i })).filter((t) => !t._matched);

      if (fromKeyword > 0) log('🏷️', `${fromKeyword} categorizad${fromKeyword !== 1 ? 'as' : 'a'} por palavras-chave`, '#6ee7b7');
      if (fromHistory > 0) log('🧠', `${fromHistory} categorizad${fromHistory !== 1 ? 'as' : 'a'} pelo histórico`, '#6ee7b7');

      // Step D: AI categorization in batches. Kept high (150) so a typical month's worth
      // of unmatched transactions fits in a single request — batching was needed for the
      // old local Ollama model (small context), but repeating the fixed prompt (categories +
      // rules + history) per batch wastes tokens now that caching doesn't kick in below ~2K
      // tokens. 150 items keeps output comfortably under max_tokens (4096).
      let aiCatMap = {};
      if (needsAI.length > 0) {
        const BATCH = 150;
        const batches = [];
        for (let i = 0; i < needsAI.length; i += BATCH) batches.push(needsAI.slice(i, i + BATCH));

        log('🤖', `Enviando ${needsAI.length} transações para Claude em ${batches.length} lote${batches.length !== 1 ? 's' : ''}...`);

        const memoryForPrompt = Object.entries(historyMap)
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 15)
          .map(([, v]) => ({ label: v.label, category_id: v.category_id }));

        // Stable across every batch of this run — sent as a cached content block.
        const stablePrompt = buildCategorizationStablePrompt(memoryForPrompt, cats);
        const totalUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

        for (let b = 0; b < batches.length; b++) {
          if (cancelledRef.current) return;

          const batch = batches[b];
          const variablePrompt = buildCategorizationVariablePrompt(batch);

          abortCtrlRef.current = new AbortController();
          const res = await fetch('/api/transactions/categorize-ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stable: stablePrompt, variable: variablePrompt }),
            signal: abortCtrlRef.current.signal,
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(err.error || `Falha na categorização por IA (status ${res.status})`);
          }

          const data = await res.json();
          if (cancelledRef.current) return;
          const raw  = data?.content ?? '';
          const u = data?.usage;
          if (u) {
            totalUsage.input += u.input_tokens ?? 0;
            totalUsage.output += u.output_tokens ?? 0;
            totalUsage.cacheRead += u.cache_read_input_tokens ?? 0;
            totalUsage.cacheWrite += u.cache_creation_input_tokens ?? 0;
            const cacheNote = (u.cache_read_input_tokens ?? 0) > 0
              ? ` (${u.cache_read_input_tokens} do cache)`
              : (u.cache_creation_input_tokens ?? 0) > 0 ? ' (gravando cache)' : '';
            log('🔢', `Lote ${b + 1}: ${u.input_tokens ?? 0} tokens in${cacheNote}, ${u.output_tokens ?? 0} out`, '#818cf8');
          }
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[0]);
              (parsed.categories ?? []).forEach((c) => {
                const globalTx = batch[c.index];
                if (globalTx) aiCatMap[globalTx._origIdx] = c.category_id;
              });
              log('✅', `Lote ${b + 1}/${batches.length}: ${parsed.categories?.length ?? 0} categorizações`, '#6ee7b7');
            } catch (_) { log('⚠️', `Lote ${b + 1}: JSON inválido, usando fallback`, '#fcd34d'); }
          } else {
            log('⚠️', `Lote ${b + 1}: sem JSON, usando fallback`, '#fcd34d');
          }
        }
        log('💰', `Total IA: ${totalUsage.input} tokens in (${totalUsage.cacheRead} do cache), ${totalUsage.output} tokens out`, '#a5b4fc');
      } else {
        log('✅', 'Todas as transações categorizadas sem IA', '#6ee7b7');
      }

      if (cancelledRef.current) return;

      // Merge
      const final = withHistory.map((t, globalIdx) => {
        const clean = (o) => { const c = { ...o }; delete c._matched; delete c._origIdx; return c; };
        if (t._matched) return clean(t);
        const catId = aiCatMap[globalIdx];
        const valid = catId && catById[catId] && catById[catId].type === t.type;
        if (valid) return clean({ ...t, category_id: catId });
        // Fallback for transactions the AI didn't categorize (missing index, or a batch
        // that failed to parse): the "Outros"-named category of the type, resolved from
        // the live list — NOT the first category of the type, which would silently
        // mislabel them.
        return clean({ ...t, category_id: fallbackCategoryId(catById, t.type) });
      });

      log('🎉', `Pronto! ${final.length} transaç${final.length !== 1 ? 'ões' : 'ão'} pronta${final.length !== 1 ? 's' : ''} para revisão`, '#818cf8');
      setRunning(false);
      setPendingResult({ transactions: final, totalExtracted: newTx.length, skipped });
    } catch (e) {
      if (cancelledRef.current || e.name === 'AbortError') return;
      const msg = (e.name === 'TypeError' && e.message.includes('fetch'))
        ? 'Não foi possível conectar à API de categorização.'
        : e.message;
      log('❌', msg, '#f87171');
      setError(msg);
      setRunning(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* File list */}
      <div style={{ background: '#111827', borderRadius: 16, padding: 20, border: '1px solid #1f2937' }}>
        <p style={{ color: '#9ca3af', fontSize: 13, marginBottom: 12 }}>Arquivos para processar:</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {files.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>📄</span>
              <span style={{ color: '#e5e7eb', fontSize: 14 }}>{f.name}</span>
              <span style={{ color: '#6b7280', fontSize: 12 }}>({fmtBytes(f.size)})</span>
            </div>
          ))}
        </div>
      </div>

      {/* Log window */}
      {logs.length > 0 && (
        <div style={{ background: '#0d1117', borderRadius: 12, border: '1px solid #1f2937', overflow: 'hidden' }}>
          <div style={{ padding: '8px 14px', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', gap: 8 }}>
            {running && <Loader2 size={13} style={{ color: '#818cf8', animation: 'spin 1s linear infinite', flexShrink: 0 }} />}
            <span style={{ color: '#6b7280', fontSize: 11, fontFamily: 'monospace' }}>log de processamento</span>
          </div>
          <div ref={logRef} style={{ padding: '10px 14px', maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {logs.map((l, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                <span style={{ color: '#374151', fontSize: 10, fontFamily: 'monospace', flexShrink: 0 }}>{l.ts}</span>
                <span style={{ fontSize: 13 }}>{l.icon}</span>
                <span style={{ color: l.color, fontSize: 12, fontFamily: 'monospace' }}>{l.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 20px', background: 'rgba(239,68,68,0.08)', borderRadius: 12, border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertCircle size={18} style={{ color: '#f87171', flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ color: '#fca5a5', fontWeight: 600, margin: '0 0 4px' }}>Erro ao processar</p>
            <p style={{ color: '#9ca3af', fontSize: 13, margin: 0 }}>{error}</p>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <button onClick={handleBack} className="btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ChevronLeft size={16} /> Voltar
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          {running && (
            <button onClick={stop} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
              borderRadius: 10, border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)',
              color: '#f87171', cursor: 'pointer', fontSize: 14, fontWeight: 500,
            }}>
              <X size={15} /> Parar
            </button>
          )}
          {allExistsCount > 0 && !running ? (
            <button onClick={() => navigate('/')} className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle size={16} /> Fechar
            </button>
          ) : pendingResult && !running ? (
            <button onClick={() => onDone(pendingResult)} className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ChevronRight size={16} /> Continuar para revisão
            </button>
          ) : (
            <button onClick={process} disabled={running} className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: running ? 0.6 : 1 }}>
              {running ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={16} />}
              {running ? 'Processando...' : 'Processar com IA'}
            </button>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── New category modal ───────────────────────────────────────────────────────

const ICON_OPTIONS = [
  { group: 'Finanças',     icons: ['💰','💵','💳','🏦','📈','📉','💹','💸','🪙','🏧'] },
  { group: 'Trabalho',     icons: ['💼','🖥️','💻','📱','📞','🖨️','⌨️','🗂️','📋','✍️'] },
  { group: 'Casa',         icons: ['🏠','🏡','🏗️','🛋️','🔧','🪣','💡','🔑','🚿','🛁'] },
  { group: 'Alimentação',  icons: ['🍽️','🍔','🍕','🥗','☕','🍺','🧃','🛒','🍰','🥩'] },
  { group: 'Transporte',   icons: ['🚗','✈️','🚌','🚇','🚲','⛽','🛵','🚕','🚢','🚁'] },
  { group: 'Saúde',        icons: ['🏥','💊','🩺','🧬','💉','🩹','🏋️','🧘','🦷','👓'] },
  { group: 'Educação',     icons: ['📚','🎓','✏️','📐','🔬','🖊️','📖','🏫','🧪','📝'] },
  { group: 'Lazer',        icons: ['🎮','🎵','🎬','🏖️','⚽','🎯','🎲','🎸','🎭','🏄'] },
  { group: 'Compras',      icons: ['🛍️','👕','👟','💍','🕶️','👜','🧢','⌚','📦','🎁'] },
  { group: 'Outros',       icons: ['📦','⭐','🔖','🗓️','🔔','📌','🏷️','♻️','🎀','❤️'] },
];

function NewCategoryModal({ type, onClose, onCreated }) {
  const [name, setName]   = useState('');
  const [icon, setIcon]   = useState('💰');
  const [color, setColor] = useState('#6366f1');
  const [saving, setSaving] = useState(false);
  const [err, setErr]     = useState(null);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const cat = await api.createCategory({ name: name.trim(), type, icon, color });
      onCreated(cat);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: '#1f2937', border: '1px solid #374151', borderRadius: 16,
        padding: 24, width: 340, display: 'flex', flexDirection: 'column', gap: 16,
      }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ color: '#f3f4f6', margin: 0, fontSize: 16, fontWeight: 600 }}>Nova categoria</h3>

        {/* Icon + name row */}
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Icon preview */}
          <div style={{
            width: 44, height: 36, borderRadius: 8, background: '#111827',
            border: '1px solid #374151', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 20, flexShrink: 0,
          }}>
            {icon}
          </div>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Nome da categoria" className="input" style={{ flex: 1, padding: '6px 10px' }} />
        </div>

        {/* Icon dropdown */}
        <div>
          <label style={{ color: '#9ca3af', fontSize: 12, marginBottom: 6, display: 'block' }}>Ícone</label>
          <select
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            className="input"
            style={{ fontSize: 15 }}
          >
            {ICON_OPTIONS.map(({ group, icons }) => (
              <optgroup key={group} label={group}>
                {icons.map((ic) => (
                  <option key={ic} value={ic}>{ic}  {ic}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Color */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ color: '#9ca3af', fontSize: 13 }}>Cor:</label>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
            style={{ width: 36, height: 28, border: 'none', borderRadius: 6, cursor: 'pointer', background: 'none' }} />
          <span style={{
            fontSize: 12, padding: '2px 10px', borderRadius: 20,
            background: `${color}22`, color, fontWeight: 500,
          }}>
            {icon} {name || 'Prévia'}
          </span>
          <span style={{ color: '#6b7280', fontSize: 12, marginLeft: 'auto' }}>
            {type === 'expense' ? 'Despesa' : 'Receita'}
          </span>
        </div>

        {err && <p style={{ color: '#f87171', fontSize: 12, margin: 0 }}>{err}</p>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="btn-ghost" style={{ fontSize: 13 }}>Cancelar</button>
          <button onClick={save} disabled={!name.trim() || saving} className="btn-primary"
            style={{ fontSize: 13, opacity: !name.trim() || saving ? 0.5 : 1 }}>
            {saving ? 'Salvando...' : 'Criar categoria'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Edita campos que não cabem na linha da tabela (notas, desconta categoria,
// extraordinária, transferência) — só mexe no estado local da revisão, sem API,
// já que a transação ainda não foi importada.
function EditRowModal({ transaction, allCategories, onClose, onSave }) {
  const [notes, setNotes] = useState(transaction.notes || '');
  const [offsetsCategoryId, setOffsetsCategoryId] = useState(transaction.offsets_category_id || '');
  const [isExtraordinary, setIsExtraordinary] = useState(!!transaction.is_extraordinary);
  const [isTransfer, setIsTransfer] = useState(!!transaction.is_transfer);

  const expenseCategories = allCategories.filter((c) => c.type === 'expense');

  function save() {
    onSave({
      notes,
      offsets_category_id: offsetsCategoryId ? Number(offsetsCategoryId) : null,
      is_extraordinary: isExtraordinary,
      is_transfer: isTransfer,
    });
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: '#1f2937', border: '1px solid #374151', borderRadius: 16,
        padding: 24, width: 380, display: 'flex', flexDirection: 'column', gap: 16,
      }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ color: '#f3f4f6', margin: 0, fontSize: 16, fontWeight: 600 }}>
          Editar transação
        </h3>
        <p style={{ color: '#6b7280', fontSize: 12, margin: '-8px 0 0' }} title={transaction.description}>
          {transaction.description}
        </p>

        {transaction.type === 'income' && (
          <div>
            <label style={{ color: '#9ca3af', fontSize: 12, marginBottom: 6, display: 'block' }}>
              Desconta da categoria (opcional)
            </label>
            <select className="input" value={offsetsCategoryId} onChange={(e) => setOffsetsCategoryId(e.target.value)}>
              <option value="">Não descontar</option>
              {expenseCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label style={{ color: '#9ca3af', fontSize: 12, marginBottom: 6, display: 'block' }}>Notas</label>
          <input className="input" placeholder="Observações..." value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {transaction.type === 'expense' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, borderRadius: 12, border: '1px solid #374151', background: 'rgba(255,255,255,0.02)', padding: '10px 12px', cursor: 'pointer' }}>
            <input type="checkbox" checked={isExtraordinary} onChange={(e) => setIsExtraordinary(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: '#6366f1', flexShrink: 0 }} />
            <div>
              <span style={{ color: '#e5e7eb', fontSize: 13 }}>Despesa extraordinária</span>
              <p style={{ color: '#6b7280', fontSize: 11, margin: '2px 0 0' }}>Gasto pontual, fora do padrão: não entra no ritmo médio do mês.</p>
            </div>
          </label>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, borderRadius: 12, border: '1px solid #374151', background: 'rgba(255,255,255,0.02)', padding: '10px 12px', cursor: 'pointer' }}>
          <input type="checkbox" checked={isTransfer} onChange={(e) => setIsTransfer(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: '#6366f1', flexShrink: 0 }} />
          <div>
            <span style={{ color: '#e5e7eb', fontSize: 13 }}>Transferência</span>
            <p style={{ color: '#6b7280', fontSize: 11, margin: '2px 0 0' }}>Sai do saldo, mas não conta como despesa ou receita real (ex.: aporte em investimentos).</p>
          </div>
        </label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="btn-ghost" style={{ fontSize: 13 }}>Cancelar</button>
          <button onClick={save} className="btn-primary" style={{ fontSize: 13 }}>Salvar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Shared log panel ───────────────────────────────────────────────────────
// Same look as Smart Import's processing log, extracted so other flows (Pluggy sync)
// can show live progress without a full step-wizard around it.

export function useLogger() {
  const [logs, setLogs] = useState([]);
  const logRef = useRef(null);
  function log(icon, text, color = '#9ca3af') {
    const ts = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs((prev) => [...prev, { ts, icon, text, color }]);
    setTimeout(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }); }, 30);
  }
  return { logs, log, logRef, reset: () => setLogs([]) };
}

export function LogPanel({ logs, logRef, running }) {
  if (!logs.length) return null;
  return (
    <div style={{ background: '#0d1117', borderRadius: 12, border: '1px solid #1f2937', overflow: 'hidden' }}>
      <div style={{ padding: '8px 14px', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', gap: 8 }}>
        {running && <Loader2 size={13} style={{ color: '#818cf8', animation: 'spin 1s linear infinite', flexShrink: 0 }} />}
        <span style={{ color: '#6b7280', fontSize: 11, fontFamily: 'monospace' }}>log de processamento</span>
      </div>
      <div ref={logRef} style={{ padding: '10px 14px', maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {logs.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
            <span style={{ color: '#374151', fontSize: 10, fontFamily: 'monospace', flexShrink: 0 }}>{l.ts}</span>
            <span style={{ fontSize: 13 }}>{l.icon}</span>
            <span style={{ color: l.color, fontSize: 12, fontFamily: 'monospace' }}>{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Step 3: Review ───────────────────────────────────────────────────────────

// Runs the same keyword → history → AI categorization pipeline used by Smart Import's
// file-parsing flow, but standalone: takes a plain transaction list (description/type/amount/
// date) and returns it with category_id filled in. Used by other transaction sources (Pluggy
// sync) that don't go through statement parsing but still want the same auto-categorization.
export async function categorizeTransactions(transactions, log = () => {}) {
  if (!transactions.length) return transactions;

  const allCats = await api.getCategories().catch(() => CATEGORIES);
  const catById = Object.fromEntries(allCats.map((c) => [c.id, c]));

  log('📚', 'Carregando histórico de categorizações...');
  const historyMap = await buildCategoryMemory();
  log('📚', `Histórico: ${Object.keys(historyMap).length} padrões de descrição carregados`);

  const afterKeywords = transactions.map((t) => {
    const catId = matchFromKeywords(t.description, allCats);
    const valid = catId && catById[catId] && catById[catId].type === t.type;
    return { ...t, category_id: valid ? catId : null, _matched: valid ? 'keyword' : null };
  });

  const withHistory = afterKeywords.map((t) => {
    if (t._matched) return t;
    const catId = matchFromHistory(t.description, historyMap);
    const valid = catId && catById[catId] && catById[catId].type === t.type;
    return { ...t, category_id: valid ? catId : null, _matched: valid ? 'history' : null };
  });

  const fromKeyword = withHistory.filter((t) => t._matched === 'keyword').length;
  const fromHistory = withHistory.filter((t) => t._matched === 'history').length;
  if (fromKeyword > 0) log('🏷️', `${fromKeyword} categorizad${fromKeyword !== 1 ? 'as' : 'a'} por palavras-chave`, '#6ee7b7');
  if (fromHistory > 0) log('🧠', `${fromHistory} categorizad${fromHistory !== 1 ? 'as' : 'a'} pelo histórico`, '#6ee7b7');

  const needsAI = withHistory.map((t, i) => ({ ...t, _origIdx: i })).filter((t) => !t._matched);

  let aiCatMap = {};
  if (needsAI.length > 0) {
    log('🤖', `Enviando ${needsAI.length} transação(ões) para Claude...`);
    const memoryForPrompt = Object.entries(historyMap)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 15)
      .map(([, v]) => ({ label: v.label, category_id: v.category_id }));

    const stablePrompt = buildCategorizationStablePrompt(memoryForPrompt, allCats);
    const variablePrompt = buildCategorizationVariablePrompt(needsAI);

    try {
      const res = await fetch('/api/transactions/categorize-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stable: stablePrompt, variable: variablePrompt }),
      });
      if (res.ok) {
        const data = await res.json();
        const raw = data?.content ?? '';
        const u = data?.usage;
        if (u) log('🔢', `${u.input_tokens ?? 0} tokens in, ${u.output_tokens ?? 0} tokens out`, '#818cf8');
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          (parsed.categories ?? []).forEach((c) => {
            const globalTx = needsAI[c.index];
            if (globalTx) aiCatMap[globalTx._origIdx] = c.category_id;
          });
          log('✅', `${parsed.categories?.length ?? 0} categorizações recebidas`, '#6ee7b7');
        } else {
          log('⚠️', 'Resposta sem JSON, usando fallback', '#fcd34d');
        }
      } else {
        log('⚠️', `Falha na categorização (status ${res.status}), usando fallback`, '#fcd34d');
      }
    } catch (_) {
      log('⚠️', 'Erro ao chamar categorização por IA, usando fallback', '#fcd34d');
    }
  } else {
    log('✅', 'Todas as transações categorizadas sem IA', '#6ee7b7');
  }

  log('🎉', `Pronto! ${withHistory.length} transaç${withHistory.length !== 1 ? 'ões' : 'ão'} pronta${withHistory.length !== 1 ? 's' : ''} para revisão`, '#818cf8');

  return withHistory.map((t, globalIdx) => {
    const clean = (o) => { const c = { ...o }; delete c._matched; delete c._origIdx; return c; };
    if (t._matched) return clean(t);
    const catId = aiCatMap[globalIdx];
    const valid = catId && catById[catId] && catById[catId].type === t.type;
    if (valid) return clean({ ...t, category_id: catId });
    return clean({ ...t, category_id: fallbackCategoryId(catById, t.type) });
  });
}

export function StepReview({ result, onBack }) {
  const [transactions, setTransactions] = useState(() => result.transactions);
  const [allCategories, setAllCategories] = useState(CATEGORIES);
  const [newCatFor, setNewCatFor]       = useState(null); // { idx, type } — which row triggered the modal
  const [editRowIdx, setEditRowIdx]     = useState(null); // idx of the row open in EditRowModal
  const [importing, setImporting]       = useState(false);
  const [importErr, setImportErr]       = useState(null);
  const [success, setSuccess]           = useState(false);

  // Load all categories from DB on mount so user-created ones appear
  useEffect(() => {
    api.getCategories().then((cats) => {
      if (Array.isArray(cats) && cats.length) setAllCategories(cats);
    }).catch(() => {});
  }, []);

  function update(idx, field, value) {
    setTransactions((prev) => prev.map((t, i) => i === idx ? { ...t, [field]: value } : t));
  }

  function remove(idx) {
    const t = transactions[idx];
    if (t?.import_key) api.rejectImports([t.import_key]).catch(() => {});
    if (t?.pluggy_transaction_id) api.rejectImports([t.pluggy_transaction_id]).catch(() => {});
    setTransactions((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleNewCatCreated(cat) {
    // cat comes from the API: { id, name, type, icon, color }
    setAllCategories((prev) => [...prev, { id: cat.id, type: cat.type, icon: cat.icon, name: cat.name }]);
    update(newCatFor.idx, 'category_id', cat.id);
    setNewCatFor(null);
  }

  function handleRowEdited(fields) {
    setTransactions((prev) => prev.map((t, i) => i === editRowIdx ? { ...t, ...fields } : t));
    setEditRowIdx(null);
  }

  const hasAccountTag = transactions.some((t) => t.account_type);
  const expenses = transactions.filter((t) => t.type === 'expense');
  const incomes  = transactions.filter((t) => t.type === 'income');
  const totalExp = expenses.reduce((s, t) => s + t.amount, 0);
  const totalInc = incomes.reduce((s, t) => s + t.amount, 0);
  const ok = transactions.length >= result.totalExtracted;

  async function handleImport() {
    setImporting(true);
    setImportErr(null);
    try {
      const payload = transactions.map((t) => ({
        date: t.date,
        description: t.description,
        amount: t.amount,
        type: t.type,
        category_id: t.category_id || null,
        notes: t.notes || '',
        source: t.source || null,
        pluggy_transaction_id: t.pluggy_transaction_id || null,
        offsets_category_id: t.offsets_category_id || null,
        is_extraordinary: !!t.is_extraordinary,
        is_transfer: !!t.is_transfer,
      }));
      await api.bulkCreateTransactions(payload);
      setSuccess(true);
    } catch (e) {
      setImportErr(e.message);
    } finally {
      setImporting(false);
    }
  }

  if (success) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <CheckCircle size={48} style={{ color: '#34d399', margin: '0 auto 16px' }} />
        <h3 style={{ color: '#e5e7eb', fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Importado com sucesso!</h3>
        <p style={{ color: '#6b7280', marginBottom: 24 }}>
          {expenses.length} despesa{expenses.length !== 1 ? 's' : ''} e {incomes.length} receita{incomes.length !== 1 ? 's' : ''} foram salvas.
        </p>
        <button onClick={() => onBack(true)} className="btn-primary">Nova importação</button>
      </div>
    );
  }

  const NEW_CAT_SENTINEL = '__new__';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {newCatFor && (
        <NewCategoryModal
          type={newCatFor.type}
          onClose={() => setNewCatFor(null)}
          onCreated={handleNewCatCreated}
        />
      )}

      {editRowIdx !== null && transactions[editRowIdx] && (
        <EditRowModal
          transaction={transactions[editRowIdx]}
          allCategories={allCategories}
          onClose={() => setEditRowIdx(null)}
          onSave={handleRowEdited}
        />
      )}

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: 'Despesas',  value: fmtCurrency(totalExp), color: '#f87171' },
          { label: 'Receitas',  value: fmtCurrency(totalInc), color: '#34d399' },
          { label: 'Saldo',     value: fmtCurrency(totalInc - totalExp), color: totalInc - totalExp >= 0 ? '#34d399' : '#f87171' },
          { label: 'Itens',     value: transactions.length, color: '#a5b4fc' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: '#111827', borderRadius: 14, padding: '14px 16px', border: '1px solid #1f2937', textAlign: 'center' }}>
            <p style={{ color: '#6b7280', fontSize: 11, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
            <p style={{ color, fontWeight: 700, fontSize: 16, margin: 0 }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Count check */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 12,
          background: ok ? 'rgba(52,211,153,0.08)' : 'rgba(251,191,36,0.08)',
          border: `1px solid ${ok ? 'rgba(52,211,153,0.25)' : 'rgba(251,191,36,0.3)'}`,
        }}>
          <span style={{ fontSize: 16 }}>{ok ? '✅' : '⚠️'}</span>
          <span style={{ fontSize: 13, color: ok ? '#6ee7b7' : '#fcd34d' }}>
            {ok
              ? `${transactions.length} transações novas para importar`
              : `${transactions.length} de ${result.totalExtracted} transações, verifique se alguma foi removida`}
          </span>
        </div>
        {result.skipped > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderRadius: 12,
            background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)',
          }}>
            <span style={{ fontSize: 15 }}>🔁</span>
            <span style={{ fontSize: 13, color: '#a5b4fc' }}>
              {result.skipped} transaç{result.skipped !== 1 ? 'ões' : 'ão'} já existente{result.skipped !== 1 ? 's' : ''} na base, ignorada{result.skipped !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto', borderRadius: 14, border: '1px solid #1f2937' }}>
        <table style={{ minWidth: hasAccountTag ? 1000 : 900, width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 148 }} />
            {hasAccountTag && <col style={{ width: 100 }} />}
            <col />  {/* description: takes remaining space */}
            <col style={{ width: 130 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 200 }} />
            <col style={{ width: 64 }} />
          </colgroup>
          <thead>
            <tr style={{ background: '#111827', borderBottom: '1px solid #1f2937' }}>
              {['Data', ...(hasAccountTag ? ['Conta'] : []), 'Descrição', 'Valor', 'Tipo', 'Categoria', ''].map((h) => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {transactions.map((t, i) => {
              const catOptions = allCategories.filter((c) => c.type === t.type);
              return (
                <tr key={i} style={{ borderBottom: '1px solid #1f2937', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                  <td style={{ padding: '7px 10px' }}>
                    <input type="date" value={t.date || ''} onChange={(e) => update(i, 'date', e.target.value)}
                      className="input" style={{ padding: '4px 8px', fontSize: 12, width: '100%' }} />
                  </td>
                  {hasAccountTag && (
                    <td style={{ padding: '7px 10px' }}>
                      {t.account_type && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px',
                          borderRadius: 8, fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap',
                          background: t.account_type === 'CREDIT' ? 'rgba(168,85,247,0.12)' : 'rgba(56,189,248,0.12)',
                          color: t.account_type === 'CREDIT' ? '#c084fc' : '#38bdf8',
                        }}>
                          {t.account_type === 'CREDIT' ? '💳 Cartão' : '🏦 Conta'}
                        </span>
                      )}
                    </td>
                  )}
                  <td style={{ padding: '7px 10px' }}>
                    <input type="text" value={t.description} onChange={(e) => update(i, 'description', e.target.value)}
                      className="input" style={{ padding: '4px 8px', fontSize: 12, width: '100%' }} />
                  </td>
                  <td style={{ padding: '7px 10px' }}>
                    <input type="number" step="0.01" min="0" value={t.amount}
                      onChange={(e) => update(i, 'amount', parseFloat(e.target.value) || 0)}
                      className="input" style={{ padding: '4px 8px', fontSize: 12, width: '100%' }} />
                  </td>
                  <td style={{ padding: '7px 10px' }}>
                    <button onClick={() => {
                      const next = t.type === 'expense' ? 'income' : 'expense';
                      update(i, 'type', next);
                      update(i, 'category_id', allCategories.find((c) => c.type === next)?.id);
                    }} style={{
                      display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px',
                      borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500,
                      background: t.type === 'expense' ? 'rgba(239,68,68,0.12)' : 'rgba(52,211,153,0.12)',
                      color: t.type === 'expense' ? '#f87171' : '#34d399',
                      width: '100%', justifyContent: 'center',
                    }}>
                      <ArrowUpDown size={12} />
                      {t.type === 'expense' ? 'Despesa' : 'Receita'}
                    </button>
                  </td>
                  <td style={{ padding: '7px 10px' }}>
                    <select
                      value={t.category_id || ''}
                      onChange={(e) => {
                        if (e.target.value === NEW_CAT_SENTINEL) {
                          setNewCatFor({ idx: i, type: t.type });
                        } else {
                          update(i, 'category_id', parseInt(e.target.value, 10));
                        }
                      }}
                      className="input" style={{ padding: '4px 8px', fontSize: 12, width: '100%' }}>
                      <option value="" disabled>Selecione...</option>
                      {catOptions.map((c) => (
                        <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                      ))}
                      <option disabled>──────────</option>
                      <option value={NEW_CAT_SENTINEL}>+ Nova categoria...</option>
                    </select>
                  </td>
                  <td style={{ padding: '7px 8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                      <button onClick={() => setEditRowIdx(i)} title="Editar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4b5563', padding: 4, borderRadius: 6, display: 'flex' }}
                        onMouseOver={(e) => e.currentTarget.style.color = '#818cf8'}
                        onMouseOut={(e) => e.currentTarget.style.color = '#4b5563'}>
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => remove(i)} title="Remover" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4b5563', padding: 4, borderRadius: 6, display: 'flex' }}
                        onMouseOver={(e) => e.currentTarget.style.color = '#ef4444'}
                        onMouseOut={(e) => e.currentTarget.style.color = '#4b5563'}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {transactions.length === 0 && (
          <p style={{ color: '#6b7280', textAlign: 'center', padding: '24px', fontSize: 14 }}>
            Nenhuma transação. Volte e processe novamente.
          </p>
        )}
      </div>

      {importErr && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertCircle size={16} style={{ color: '#f87171', flexShrink: 0 }} />
          <span style={{ color: '#fca5a5', fontSize: 13 }}>{importErr}</span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4 }}>
        <button onClick={() => onBack()} className="btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ChevronLeft size={16} /> Voltar
        </button>
        <button onClick={handleImport} disabled={importing || transactions.length === 0} className="btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: (importing || transactions.length === 0) ? 0.5 : 1 }}>
          {importing ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle size={16} />}
          {importing ? 'Importando...' : `Importar ${transactions.length} transaç${transactions.length !== 1 ? 'ões' : 'ão'}`}
        </button>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function SmartImport({ onImport, month, year }) {
  const [step, setStep] = useState(1);
  const [files, setFiles] = useState([]);
  const [result, setResult] = useState(null);
  const [dateFrom, setDateFrom]         = useState('');
  const [dateTo, setDateTo]             = useState('');
  const [faturaMonth, setFaturaMonth]   = useState('');

  function reset() { setStep(1); setFiles([]); setResult(null); setDateFrom(''); setDateTo(''); setFaturaMonth(''); }

  return (
    <div style={{ padding: '28px 24px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Upload size={22} style={{ color: '#818cf8' }} />
          <h1 style={{ color: '#f3f4f6', fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>File Import</h1>
        </div>
        <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>
          Carregue extratos ou faturas em .xlsx, .xls ou .csv: o app extrai as transações e a IA categoriza automaticamente.
        </p>
      </div>

      <StepBar step={step} />

      <div className="card">
        {step === 1 && <StepUpload files={files} setFiles={setFiles} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} faturaMonth={faturaMonth} setFaturaMonth={setFaturaMonth} onNext={() => setStep(2)} />}
        {step === 2 && <StepProcess files={files} dateFrom={dateFrom} dateTo={dateTo} faturaMonthOverride={faturaMonth} onBack={() => setStep(1)} onDone={(r) => { setResult(r); setStep(3); }} />}
        {step === 3 && result && <StepReview result={result} onBack={(r) => r ? reset() : setStep(2)} />}
      </div>
    </div>
  );
}
