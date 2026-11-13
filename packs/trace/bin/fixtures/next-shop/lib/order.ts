import { findProduct, saveOrder } from './store'

export interface Line { id: number; qty: number }

export function placeOrder(lines: Line[], grade: 'GOLD' | 'SILVER') {
  let sum = 0
  for (const line of lines) {
    const p = findProduct(line.id)
    if (!p || p.stock < line.qty) throw new Error(`재고 부족 ${line.id}`)
    p.stock -= line.qty
    sum += p.price * line.qty
  }
  const paid = grade === 'GOLD' ? Math.round(sum * 0.9) : sum
  return saveOrder(paid)
}
