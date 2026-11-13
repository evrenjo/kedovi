import asyncio
import uuid

from fastapi import FastAPI, Request

from shop.db import connect
from shop.order.models import OrderRequest, OrderResult
from shop.order.repository import OrderRepository
from shop.order.service import OrderService

app = FastAPI()
service = OrderService(OrderRepository(connect()))


@app.middleware("http")
async def request_id(request: Request, call_next):
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:8]
    response = await call_next(request)
    response.headers["x-request-id"] = rid
    return response


@app.post("/api/orders")
def place_order(body: OrderRequest) -> OrderResult:
    return service.place(body)


@app.get("/api/members/{member_id}/grade")
async def member_grade(member_id: int) -> dict:
    await asyncio.sleep(0)
    member = service.repo.member(member_id)
    return {"id": member_id, "grade": member["grade"]}
