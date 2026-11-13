import { expect, test } from '@playwright/test'

// 실제 API 라우트까지 (화면 → 라우트 → 주문 처리)
test('담고 주문하기', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '담기 pen' }).click()
  await page.getByRole('button', { name: '담기 pen' }).click()
  await page.getByRole('button', { name: '주문하기' }).click()
  await expect(page.getByRole('status')).toHaveText(/주문 \d+ PLACED/)
})
