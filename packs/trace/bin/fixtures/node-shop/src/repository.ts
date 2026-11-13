import type { DatabaseSync } from 'node:sqlite';

export interface Product { id: number; name: string; price: number; stock: number }

export class OrderRepository {
  constructor(private readonly db: DatabaseSync) {}

  member(id: number): { id: number; grade: string } {
    const row = this.db.prepare('select * from member where id = ?').get(id) as { id: number; grade: string } | undefined;
    if (!row) throw new Error(`member ${id}`);
    return row;
  }

  product(id: number): Product {
    return this.db.prepare('select * from product where id = ?').get(id) as unknown as Product;
  }

  decrease(id: number, qty: number): void {
    this.db.prepare('update product set stock = stock - ? where id = ?').run(qty, id);
  }

  save(memberId: number, paid: number, status: string): number {
    const r = this.db.prepare('insert into purchase_order (member_id, paid, status) values (?, ?, ?)').run(memberId, paid, status);
    return Number(r.lastInsertRowid);
  }
}
