import { useEffect, useState } from 'react'
import { fetchProducts, postOrder, type OrderResult, type Product } from './api'
import { add, total, type Cart } from './cart'

export function App() {
  const [products, setProducts] = useState<Product[]>([])
  const [cart, setCart] = useState<Cart>({})
  const [result, setResult] = useState<OrderResult | null>(null)

  useEffect(() => {
    fetchProducts().then(setProducts)
  }, [])

  const amount = total(cart, products, 'GOLD')

  async function placeOrder() {
    const lines = Object.entries(cart).map(([id, qty]) => ({ id: Number(id), qty }))
    const r = await postOrder(lines, amount)
    setResult(r)
  }

  return (
    <main>
      <h1>shop</h1>
      <ul>
        {products.map((p) => (
          <li key={p.id}>
            {p.name} {p.price}원 <button onClick={() => setCart((c) => add(c, p))}>담기 {p.name}</button>
          </li>
        ))}
      </ul>
      <p>합계 {amount}원</p>
      <button onClick={placeOrder} disabled={!amount}>주문하기</button>
      {result && <p role="status">주문 {result.orderId} {result.status}</p>}
    </main>
  )
}
