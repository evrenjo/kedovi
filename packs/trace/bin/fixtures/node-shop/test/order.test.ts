import request from 'supertest';
import { createApp } from '../src/app';

describe('주문 API', () => {
  it('담고 주문하기', async () => {
    const res = await request(createApp()).post('/api/orders').send({ memberId: 1, lines: [{ productId: 10, qty: 2 }, { productId: 11, qty: 1 }, { productId: 12, qty: 1 }] });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PARTIAL');
  });
});
