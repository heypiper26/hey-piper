const BASE = '/api';

// 20s: matches the timeout in useApi (hooks/useApi.js) for read requests. Without
// this, a hung write (e.g. a cold-start/DB-pool stall on the server) leaves whatever
// button triggered it stuck on "Salvando..." forever, with no error and no way to
// retry — this is what happened when saving a transaction edit on a slow request.
const TIMEOUT_MS = 20000;

async function req(path, opts = {}) {
  const { timeoutMs = TIMEOUT_MS, ...fetchOpts } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...fetchOpts,
      body: fetchOpts.body ? JSON.stringify(fetchOpts.body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Tempo esgotado. Tente novamente.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Erro na requisição');
  }
  return res.json();
}

let categoriesCache = null;

export const api = {
  // Auth
  login: (password) => req('/auth/login', { method: 'POST', body: { password } }),
  logout: () => req('/auth/logout', { method: 'POST' }),
  checkAuth: () => req('/auth/check'),
  changePassword: (currentPassword, newPassword) =>
    req('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),

  // Categories — cached in memory: they rarely change but every page requests them
  // on mount. Any category mutation invalidates the cache; a failed fetch is not cached.
  getCategories: () => {
    if (!categoriesCache) {
      categoriesCache = req('/categories').catch((e) => {
        categoriesCache = null;
        throw e;
      });
    }
    return categoriesCache;
  },
  createCategory: (data) => {
    categoriesCache = null;
    return req('/categories', { method: 'POST', body: data });
  },
  updateCategory: (id, data) => {
    categoriesCache = null;
    return req(`/categories/${id}`, { method: 'PUT', body: data });
  },
  deleteCategory: (id) => {
    categoriesCache = null;
    return req(`/categories/${id}`, { method: 'DELETE' });
  },
  setCategoryRecurring: (id, is_recurring) => {
    categoriesCache = null;
    return req(`/categories/${id}`, { method: 'PATCH', body: { is_recurring } });
  },

  // Transactions
  getLastUpdated: () => req('/transactions/last-updated'),
  getInstallments: (today) => req(`/transactions/installments${today ? '?today=' + today : ''}`),
  getSavedMonthlyReport: (year, month) => req(`/transactions/monthly-report?year=${year}&month=${month}`),
  // 55s: the AI report call routinely takes longer than the default 20s (Claude
  // generation + DB writes); the serverless function itself is given a matching
  // maxDuration in vercel.json so the backend doesn't get cut off first.
  generateMonthlyReport: (year, month) => req('/transactions/monthly-report', { method: 'POST', body: { year, month }, timeoutMs: 55000 }),
  getForecast: (year, month, months = 12) => req(`/transactions/forecast?year=${year}&month=${month}&months=${months}`),
  getActiveMonths: () => req('/transactions/active-months'),
  getCategoryMonthly: (category_id, months = 6) => req(`/transactions/category-monthly?category_id=${category_id}&months=${months}`),
  searchTransactions: (q) => req(`/transactions/search?q=${encodeURIComponent(q)}`),
  getTransactions: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return req(`/transactions${qs ? '?' + qs : ''}`);
  },
  getSummary: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return req(`/transactions/summary${qs ? '?' + qs : ''}`);
  },
  getMonthlyTrend: (months = 6) => req(`/transactions/monthly-trend?months=${months}`),
  getCategoryComparison: (year, month) => req(`/transactions/category-comparison?year=${year}&month=${month}`),
  getSimilarTransactions: (description, excludeId, newCategoryId) => {
    const qs = new URLSearchParams({ description, exclude_id: excludeId, new_category_id: newCategoryId }).toString();
    return req(`/transactions/similar?${qs}`);
  },
  createTransaction: (data) => req('/transactions', { method: 'POST', body: data }),
  bulkCreateTransactions: (transactions) => req('/transactions/bulk', { method: 'POST', body: { transactions } }),
  getImportKeys: (months) => req('/transactions/import-keys', { method: 'POST', body: { months } }),
  rejectImports: (keys) => req('/transactions/reject-imports', { method: 'POST', body: { keys } }),
  getRejectedImports: () => req('/transactions/rejected-imports'),
  bulkUpdateCategory: (ids, category_id) => req('/transactions/bulk-category', { method: 'PUT', body: { ids, category_id } }),
  updateTransaction: (id, data) => req(`/transactions/${id}`, { method: 'PUT', body: data }),
  toggleIgnored: (id, ignored) => req(`/transactions/${id}`, { method: 'PATCH', body: { ignored } }),
  deleteTransaction: (id) => req(`/transactions/${id}`, { method: 'DELETE' }),

  // Pluggy
  getPluggyCandidates: (since) => req(`/pluggy/candidates${since ? '?since=' + since : ''}`),

  // Patrimônio
  getPatrimonio: () => req('/patrimonio/data'),
  // Busca ao vivo na Pluggy e grava a foto de hoje — pode levar alguns segundos.
  refreshPatrimonio: () => req('/patrimonio/refresh', { method: 'POST', timeoutMs: 45000 }),
  // Bens manuais (conta no exterior, imóvel, veículo). Mutações regravam a foto na Pluggy,
  // por isso o timeout maior.
  getManualAssets: () => req('/patrimonio/manual'),
  createManualAsset: (data) => req('/patrimonio/manual', { method: 'POST', body: data, timeoutMs: 45000 }),
  updateManualAsset: (id, data) => req('/patrimonio/manual', { method: 'PUT', body: { id, ...data }, timeoutMs: 45000 }),
  deleteManualAsset: (id) => req('/patrimonio/manual', { method: 'DELETE', body: { id }, timeoutMs: 45000 }),

  // Budgets
  getBudgets: (year, month) => req(`/budgets?year=${year}&month=${month}`),
  saveBudgets: (year, month, budgets) => req('/budgets', { method: 'PUT', body: { year, month, budgets } }),
  copyBudgets: (from_year, from_month, to_year, to_month) =>
    req('/budgets/copy', { method: 'POST', body: { from_year, from_month, to_year, to_month } }),

  // Goals
  getGoals: () => req('/goals'),
  createGoal: (data) => req('/goals', { method: 'POST', body: data }),
  updateGoal: (id, data) => req(`/goals/${id}`, { method: 'PUT', body: data }),
  deleteGoal: (id) => req(`/goals/${id}`, { method: 'DELETE' }),
};
