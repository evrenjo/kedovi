from enum import Enum

from pydantic import BaseModel


class OrderStatus(str, Enum):
    PLACED = "PLACED"
    PARTIAL = "PARTIAL"


class Line(BaseModel):
    product_id: int
    qty: int


class OrderRequest(BaseModel):
    member_id: int
    lines: list[Line]


class OrderResult(BaseModel):
    order_id: int
    paid: float
    status: OrderStatus
    skipped: list[str]
