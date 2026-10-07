import sql from './db.js';
import pluggy from './pluggy.js';

// "Hoje" no fuso local (America/Sao_Paulo). Mesma convenção do resto do app: datas
// como TEXT YYYY-MM-DD no fuso local, evitando o deslocamento de dia que aconteceria
// ao fatiar um timestamp UTC depois das 21h.
function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Foto ao vivo: soma saldos de contas, investimentos e faturas de cartão via Pluggy.
// A Pluggy só entrega o valor atual (sem histórico), então esta é a base de cada snapshot.
export async function computeCurrent() {
  const itemId = process.env.PLUGGY_ITEM_ID;

  const [{ results: accounts = [] }, investmentsResp, manualRows] = await Promise.all([
    pluggy.fetchAccounts(itemId),
    pluggy.fetchInvestments(itemId).catch(() => ({ results: [] })),
    sql`SELECT nome, categoria, valor, incluir_investimentos FROM patrimonio_manual ORDER BY valor DESC`,
  ]);
  const investments = investmentsResp?.results || [];

  const contasList = [];
  const dividasList = [];
  for (const acc of accounts) {
    const balance = round2(acc.balance);
    if (acc.type === 'CREDIT') {
      // Cartão: balance = fatura em aberto (valor devido). Entra como dívida (positivo).
      dividasList.push({ name: acc.name, balance });
    } else {
      contasList.push({ name: acc.name, subtype: acc.subtype, balance });
    }
  }

  const investList = investments.map((inv) => ({
    name: inv.name,
    type: inv.type,
    subtype: inv.subtype,
    // `balance` é o líquido após taxas; fallback para amount se ausente.
    balance: round2(inv.balance ?? inv.amount),
    // vencimento (renda fixa) — usado para consolidar os títulos de um mesmo emissor
    // por data no drill-down da página de Patrimônio; null para ações/fundos.
    dueDate: inv.dueDate ?? null,
    // taxa (ex.: IPCA + 6%, 100% do CDI) — exibida junto ao vencimento no Tesouro Direto.
    rate: inv.rate ?? null,
    rateType: inv.rateType ?? null,
  }));

  const manualList = manualRows.map((m) => ({
    nome: m.nome,
    categoria: m.categoria,
    valor: round2(m.valor),
    incluir_investimentos: !!m.incluir_investimentos,
  }));

  // Itens manuais marcados "incluir nos investimentos" (ex. Ações Globais) entram no
  // grupo de investimentos (gráficos/lista da página) em vez de Bens e Obrigações —
  // sem contar em dobro no total: saem de `manuais` e entram em `investimentos`.
  const manualInvestList = manualList
    .filter((m) => m.incluir_investimentos)
    .map((m) => ({
      name: m.nome,
      type: 'MANUAL',
      subtype: null,
      balance: m.valor,
      dueDate: null,
      rate: null,
      rateType: null,
      manual: true,
      categoria: m.categoria,
    }));
  const manualOtherList = manualList.filter((m) => !m.incluir_investimentos);

  const contas = round2(contasList.reduce((s, a) => s + a.balance, 0));
  const dividas = round2(dividasList.reduce((s, a) => s + a.balance, 0));
  const investimentos = round2(
    investList.reduce((s, a) => s + a.balance, 0) + manualInvestList.reduce((s, a) => s + a.balance, 0)
  );
  const manuais = round2(manualOtherList.reduce((s, a) => s + a.valor, 0));
  const patrimonio = round2(contas + investimentos + manuais - dividas);

  return {
    date: today(),
    contas,
    investimentos,
    manuais,
    dividas,
    patrimonio,
    detalhes: {
      contas: contasList,
      dividas: dividasList,
      investimentos: [...investList, ...manualInvestList],
      manuais: manualList,
    },
  };
}

// Busca ao vivo na Pluggy e grava (upsert) a foto de hoje. Uma linha por `date`, então
// múltiplas chamadas no mesmo dia sobrescrevem — a série cresce um ponto por dia.
export async function snapshotNow() {
  const current = await computeCurrent();
  await sql`
    INSERT INTO patrimonio_snapshots (date, contas, investimentos, manuais, dividas, patrimonio, detalhes)
    VALUES (${current.date}, ${current.contas}, ${current.investimentos}, ${current.manuais},
            ${current.dividas}, ${current.patrimonio}, ${sql.json(current.detalhes)})
    ON CONFLICT (date) DO UPDATE SET
      contas = EXCLUDED.contas,
      investimentos = EXCLUDED.investimentos,
      manuais = EXCLUDED.manuais,
      dividas = EXCLUDED.dividas,
      patrimonio = EXCLUDED.patrimonio,
      detalhes = EXCLUDED.detalhes
  `;
  return current;
}

export async function fetchHistory() {
  return sql`
    SELECT date, contas, investimentos, manuais, dividas, patrimonio
    FROM patrimonio_snapshots
    ORDER BY date ASC
  `;
}
