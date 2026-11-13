import type { OrderRepository } from './repository';

export interface OrderRequest { memberId: number; lines: { productId: number; qty: number }[] }

export class OrderService {
  constructor(private readonly repo: OrderRepository) {}

  async place(req: OrderRequest) {
    const member = this.repo.member(req.memberId);
    let total = 0;
    const skipped: string[] = [];
    for (const line of req.lines) {
      const product = this.repo.product(line.productId);
      if (product.stock < line.qty) {
        skipped.push(product.name);
        continue;
      }
      this.repo.decrease(line.productId, line.qty);
      total += product.price * line.qty;
    }
    const paid = this.discount(member.grade, total);
    const status = skipped.length ? 'PARTIAL' : 'PLACED';
    const orderId = this.repo.save(member.id, paid, status);
    return { orderId, paid, status, skipped };
  }

  discount(grade: string, total: number): number {
    if (grade === 'GOLD') {
      const rate = 0.1;
      return total - total * rate;
    }
    return total;
  }
}
