'use client'
import { useState } from 'react'
import type { Product } from '@/lib/store'
import { add, total, type Cart } from './cart'
import { restock } from './actions'

export function Shop({ products }: { products: Product[] }) {
  const [cart, setCart] = useState<Cart>({})
  const [result, setResult] = useState<{ orderId: number; status: string } | null>(null)
  const [stock, setStock] = useState<number | null>(null)
  const amount = total(cart, products, 'GOLD')

  async function order() {
    const lines = Object.entries(cart).map(([id, qty]) => ({ id: Number(id), qty }))
    const res = await fetch('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines }) })
    setResult(await res.json())
  }

  return (
    <section>
      <ul>
        {products.map((p) => (
          <li key={p.id}>
            {p.name} {p.price}원 <button onClick={() => setCart((c) => add(c, p))}>담기 {p.name}</button>
          </li>
        ))}
      </ul>
      <p>합계 {amount}원</p>
      <button onClick={order} disabled={!amount}>주문하기</button>
      {result && <p role="status">주문 {result.orderId} {result.status}</p>}
      <button onClick={async () => setStock((await restock(11, 2)).stock)}>bag 채우기</button>
      {stock !== null && <p role="note">bag 재고 {stock}</p>}
    </section>
  )
}
