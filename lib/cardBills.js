import sql from './db.js';
import pluggy from './pluggy.js';
import { isoDay } from './pluggyMap.js';

// Mirrors a card account's closed faturas (due/closing date, total, payment) into card_bills
// and returns them keyed by Pluggy bill id, which is how closed-statement transactions point
// at their fatura. One row per card account and due month; readers add up the cards that
// fall due in the same month.
export async function syncCardBills(accountId) {
  const { results: bills } = await pluggy.fetchCreditCardBills(accountId);

  const rows = bills.filter((b) => b.dueDate).map((b) => {
    const payments = b.payments || [];
    const lastPayment = payments.map((p) => p.paymentDate).filter(Boolean).map(isoDay).sort().pop();
    return {
      account_id: accountId,
      due_month: isoDay(b.dueDate).slice(0, 7),
      due_date: isoDay(b.dueDate),
      closing_date: b.billClosingDate ? isoDay(b.billClosingDate) : null,
      total_amount: b.totalAmount,
      paid_amount: payments.length ? payments.reduce((s, p) => s + Number(p.amount || 0), 0) : null,
      paid_date: lastPayment || null,
    };
  });

  if (rows.length) {
    await sql`
      INSERT INTO card_bills ${sql(rows)}
      ON CONFLICT (account_id, due_month) DO UPDATE SET
        due_date = EXCLUDED.due_date,
        closing_date = COALESCE(EXCLUDED.closing_date, card_bills.closing_date),
        total_amount = EXCLUDED.total_amount,
        paid_amount = EXCLUDED.paid_amount,
        paid_date = EXCLUDED.paid_date,
        updated_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
    `;
  }

  return new Map(bills.map((b) => [b.id, b]));
}
