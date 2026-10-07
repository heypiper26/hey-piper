export function isCard(t) {
  const src = (t.source || '').toLowerCase();
  return src === 'credit_card' || src.includes('cart') || src.includes('credit');
}
