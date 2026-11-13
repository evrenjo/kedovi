export interface Product { id: number; name: string; price: number; stock: number }

const products: Product[] = [
  { id: 10, name: 'pen', price: 1000, stock: 3 },
  { id: 11, name: 'bag', price: 5000, stock: 1 },
]
let nextId = 100

export function listProducts(): Product[] {
  return products.map((p) => ({ ...p }))
}

export function findProduct(id: number): Product | undefined {
  return products.find((p) => p.id === id)
}

export function saveOrder(paid: number) {
  nextId += 1
  return { orderId: nextId, paid, status: 'PLACED' }
}
