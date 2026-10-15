import { Landmark } from 'lucide-react';
import { fmt } from '../utils/format.js';
import { mask } from '../hooks/useHideValues.js';

const dayMonth = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function Figure({ label, value, hint, tone = 'text-gray-200', hidden }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className={`font-semibold tabular-nums ${tone}`}>{mask(fmt.currency(value), hidden)}</p>
      {hint && <p className="text-xs text-gray-600 mt-0.5">{hint}</p>}
    </div>
  );
}

// Cash side of the month, next to the competência KPIs: what actually went through the
// checking account plus the fatura debited in the month (never the individual card
// purchases). For the current month it also projects the account balance forward.
// The data is fetched by the Dashboard alongside its other requests, not here: this card
// only mounts once the summary has arrived, which would start its request last.
export default function CashCard({ data, hidden }) {
  if (!data) return null;

  const { bill, projection: p, balance } = data;
  const signed = (v) => (v < 0 ? 'text-red-400' : 'text-emerald-400');

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <Landmark size={16} className="text-cyan-400" />
        <h3 className="text-sm font-medium text-gray-300">Caixa</h3>
        <span className="text-xs text-gray-600">o que passou pela conta, com a fatura no dia em que é paga</span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Figure label="Entradas" value={data.income} tone="text-emerald-400" hidden={hidden} />
        <Figure label="Saídas" value={data.expense} tone="text-red-400" hidden={hidden} />
        <Figure
          label="Investimentos"
          value={data.investments}
          hint="resgates − aplicações"
          tone={signed(data.investments)}
          hidden={hidden}
        />
        <Figure
          label="Fatura do cartão"
          value={bill.amount}
          hint={bill.amount > 0 ? `${bill.paid ? 'paga em' : 'vence em'} ${dayMonth(bill.due_date)}` : null}
          tone={bill.paid ? 'text-red-400' : 'text-gray-500'}
          hidden={hidden}
        />
        <Figure label="Resultado de caixa" value={data.net} tone={signed(data.net)} hidden={hidden} />
      </div>

      {p && (
        <div className="border-t border-gray-800 mt-4 pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Figure
              label="Saldo da conta"
              value={balance.amount}
              hint={`atualizado em ${dayMonth(balance.date)}`}
              tone={signed(balance.amount)}
              hidden={hidden}
            />
            <Figure
              label="Projetado no fim do mês"
              value={p.endOfMonth}
              hint={`+ ${mask(fmt.currency(p.incomeAhead), hidden)} a entrar · − ${mask(fmt.currency(p.expenseAhead + p.billAhead), hidden)} a sair`}
              tone={signed(p.endOfMonth)}
              hidden={hidden}
            />
            <Figure
              label={`Projetado após a fatura de ${dayMonth(p.nextBill.due_date)}`}
              value={p.afterNextBill}
              hint={`fatura prevista de ${mask(fmt.currency(p.nextBill.projected), hidden)}`}
              tone={signed(p.afterNextBill)}
              hidden={hidden}
            />
          </div>
          <p className="text-xs text-gray-600 mt-3">
            Considera o que falta do orçado nas categorias fixas pagas pela conta. Resgates futuros não entram.
          </p>
        </div>
      )}
    </div>
  );
}
