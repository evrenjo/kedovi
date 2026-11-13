import sqlite3


class OrderRepository:
    def __init__(self, con: sqlite3.Connection) -> None:
        self.con = con

    def member(self, member_id: int) -> sqlite3.Row:
        row = self.con.execute("select * from member where id = ?", (member_id,)).fetchone()
        if row is None:
            raise LookupError(f"member {member_id}")
        return row

    def product(self, product_id: int) -> dict:
        row = self.con.execute("select * from product where id = ?", (product_id,)).fetchone()
        return dict(row)

    def decrease(self, product_id: int, qty: int) -> None:
        self.con.execute("update product set stock = stock - ? where id = ?", (qty, product_id))

    def save(self, member_id: int, paid: float, status: str) -> int:
        cur = self.con.execute("insert into purchase_order (member_id, paid, status) values (?, ?, ?)", (member_id, paid, status))
        return int(cur.lastrowid)
