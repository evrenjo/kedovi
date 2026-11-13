import express from 'express';
import { connect } from './db';
import { OrderRepository } from './repository';
import { OrderService } from './service';

export function createApp() {
  const service = new OrderService(new OrderRepository(connect()));
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const rid = req.header('x-request-id') ?? Math.random().toString(36).slice(2, 10);
    res.setHeader('x-request-id', rid);
    next();
  });
  app.post('/api/orders', async (req, res) => {
    const result = await service.place(req.body);
    res.json(result);
  });
  return app;
}
