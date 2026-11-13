import { placeOrder } from '@/lib/order'

export async function POST(req: Request) {
  const body = await req.json()
  const result = placeOrder(body.lines, 'GOLD')
  return Response.json(result)
}
