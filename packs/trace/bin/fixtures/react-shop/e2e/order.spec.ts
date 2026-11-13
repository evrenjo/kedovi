import { expect, test } from '@playwright/test'

// 백엔드 없이: 상품 · 주문 API 를 흉내 낸다
test('담고 주문하기', async ({ page }) => {
  await page.route('**/api/products', (route) => route.fulfill({ json: [{ id: 10, name: 'pen', price: 1000, stock: 3 }] }))
  await page.route('**/api/orders', (route) => route.fulfill({ json: { orderId: 99, paid: 1800, status: 'PLACED' } }))
  await page.goto('/')
  await page.getByRole('button', { name: '담기 pen' }).click()
  await page.getByRole('button', { name: '담기 pen' }).click()
  await page.getByRole('button', { name: '주문하기' }).click()
  await expect(page.getByRole('status')).toHaveText('주문 99 PLACED')
})
