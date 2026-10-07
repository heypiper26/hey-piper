const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const fmt = {
  currency: (v) => brl.format(v || 0),

  date: (d) =>
    new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }),

  monthYear: (y, m) => {
    const name = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
    return `${name.charAt(0).toUpperCase() + name.slice(1)} / ${y}`;
  },

  percent: (v) => `${(v * 100).toFixed(1)}%`,
};
