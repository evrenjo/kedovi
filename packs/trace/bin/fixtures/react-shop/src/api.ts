export interface Product { id: number; name: string; price: number; stock: number }
export interface OrderResult { orderId: number; paid: number; status: string }

export async function fetchProducts(): Promise<Product[]> {
  const res = await fetch('/api/products')
  if (!res.ok) throw new Error(`상품 목록 ${res.status}`)
  return res.json()
}

export async function postOrder(lines: { id: number; qty: number }[], total: number): Promise<OrderResult> {
  const res = await fetch('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines, total }) })
  return res.json()
}
