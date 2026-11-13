import type { Product } from './api'

export type Cart = Record<number, number>

export function add(cart: Cart, p: Product): Cart {
  const qty = (cart[p.id] ?? 0) + 1
  if (qty > p.stock) return cart
  return { ...cart, [p.id]: qty }
}

export function total(cart: Cart, products: Product[], grade: 'GOLD' | 'SILVER'): number {
  let sum = 0
  for (const [id, qty] of Object.entries(cart)) {
    const p = products.find((x) => x.id === Number(id))
    if (!p) continue
    sum += p.price * qty
  }
  return grade === 'GOLD' ? Math.round(sum * 0.9) : sum
}
