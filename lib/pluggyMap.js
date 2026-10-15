// Pluggy timestamps are UTC. the bank's local time is America/Sao_Paulo (UTC-3), so a purchase made
// after 21:00 local time lands on the next UTC calendar day — slicing the raw UTC string would
// silently shift those purchases a day (or, combined with month math, sometimes a whole month) late.
export function toLocalDate(dateStr) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(dateStr));
}

export function addMonths(dateStr, months) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

// Bill dates come back as midnight-UTC calendar days (a Date from the SDK, a string from raw
// JSON), so they are read in UTC — converting to São Paulo time would pull them a day back.
export function isoDay(d) {
  return new Date(d).toISOString().slice(0, 10);
}

// Which fatura (YYYY-MM of its due date) a card transaction is billed on. This is the cash-side
// date of a card purchase, kept apart from `date` (competência). Pluggy reports it three ways:
//   - `billId`: closed-statement rows, resolved through the bills list (authoritative);
//   - `billForecastDate`: open and future statements, already the due month;
//   - neither: older-format pending parcelas, whose `date` is itself the due date.
export function invoiceMonthOf(tx, billById) {
  const meta = tx.creditCardMetadata || {};
  const bill = meta.billId && billById?.get(meta.billId);
  if (bill?.dueDate) return isoDay(bill.dueDate).slice(0, 7);
  if (meta.billForecastDate) return meta.billForecastDate.slice(0, 7);
  if (meta.totalInstallments > 1) return toLocalDate(tx.date).slice(0, 7);
  return null;
}

// Both legs of paying the fatura — "Pagamento recebido" on the card and the "Débito automático"
// on the checking account — move money between the user's own accounts. The purchases are
// already booked one by one, so importing either leg would double count; the payment itself is
// tracked in card_bills instead.
export function isBillPayment(tx) {
  return tx.category === 'Credit card payment';
}

export function mapTransaction(tx, account, billById) {
  const isCredit = account.type === 'CREDIT';
  // Foreign-currency purchases report `amount` in the original currency (e.g. USD); the BRL value
  // billed to the account is in `amountInAccountCurrency` when present.
  const rawAmount = tx.amountInAccountCurrency ?? tx.amount;
  const amount = Math.abs(rawAmount);
  const type = isCredit
    ? (rawAmount > 0 ? 'expense' : 'income')
    : (rawAmount < 0 ? 'expense' : 'income');

  // Installment purchases report `date` as that parcela's invoice date, not when the purchase
  // happened. Rebuild the real month from the original purchase date + installment offset —
  // parcela 2/3 of a June 10 purchase becomes July 10, parcela 3/3 becomes August 10 — so the
  // budget shows spending spread across the months it actually happened instead of clustering
  // on the due-date day. The fatura it is actually charged on goes to `invoice_month`.
  const installment = tx.creditCardMetadata;
  const date = installment && installment.totalInstallments > 1
    ? addMonths(toLocalDate(installment.purchaseDate), installment.installmentNumber - 1)
    : toLocalDate(tx.date);

  return {
    pluggy_transaction_id: tx.id,
    date,
    amount,
    type,
    description: tx.description || '',
    // Match the exact values Transactions.jsx expects (SOURCE_LABELS/SOURCE_ICONS keys) so
    // the Conta/Cartão badge renders — a free-form "Pluggy: <account>" string doesn't match.
    source: isCredit ? 'credit_card' : 'bank_account',
    invoice_month: isCredit ? invoiceMonthOf(tx, billById) : null,
    account_type: account.type,
    account_name: account.name,
  };
}
