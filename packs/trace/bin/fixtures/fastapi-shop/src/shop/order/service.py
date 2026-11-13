from shop.order.models import OrderRequest, OrderResult, OrderStatus
from shop.order.repository import OrderRepository


class OrderService:
    def __init__(self, repo: OrderRepository) -> None:
        self.repo = repo

    def place(self, request: OrderRequest) -> OrderResult:
        member = self.repo.member(request.member_id)
        total = 0.0
        skipped: list[str] = []
        for line in request.lines:
            product = self.repo.product(line.product_id)
            if product["stock"] < line.qty:
                skipped.append(product["name"])
                continue
            self.repo.decrease(line.product_id, line.qty)
            total += product["price"] * line.qty
        paid = self.discount(member["grade"], total)
        status = OrderStatus.PLACED if not skipped else OrderStatus.PARTIAL
        order_id = self.repo.save(member["id"], paid, status.value)
        return OrderResult(order_id=order_id, paid=paid, status=status, skipped=skipped)

    def discount(self, grade: str, total: float) -> float:
        if grade == "GOLD":
            rate = 0.10
            return total - total * rate
        return total
