import { describe, expect, it } from 'vitest'
import { add, total } from './cart'

const products = [
  { id: 10, name: 'pen', price: 1200, stock: 5 },
  { id: 11, name: 'note', price: 3000, stock: 0 },
]

describe('cart', () => {
  it('재고 안에서 담고 등급 할인', () => {
    let c = add({}, products[0])
    c = add(c, products[0])
    c = add(c, products[1])
    expect(total(c, products, 'GOLD')).toBe(2160)
  })
})
