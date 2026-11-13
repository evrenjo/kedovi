import sqlite3

_SEED = """
create table member (id integer primary key, name text, grade text);
create table product (id integer primary key, name text, price real, stock integer);
create table purchase_order (id integer primary key autoincrement, member_id integer, paid real, status text);
insert into member values (1, 'kim', 'GOLD'), (2, 'lee', 'SILVER');
insert into product values (10, 'pen', 1200, 5), (11, 'note', 3000, 0), (12, 'bag', 25000, 2);
"""


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(":memory:", check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.executescript(_SEED)
    return con
