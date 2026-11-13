import { listProducts } from '@/lib/store'
import { Shop } from './shop'

export default async function Page() {
  const products = listProducts()
  return (
    <main>
      <h1>shop</h1>
      <Shop products={products} />
    </main>
  )
}
