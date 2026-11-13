'use server'
import { findProduct } from '@/lib/store'

export async function restock(id: number, qty: number) {
  const p = findProduct(id)
  if (!p) return { ok: false, stock: 0 }
  p.stock += qty
  return { ok: true, stock: p.stock }
}
