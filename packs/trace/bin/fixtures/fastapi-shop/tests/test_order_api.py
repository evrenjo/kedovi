from fastapi.testclient import TestClient

from shop.web.app import app

client = TestClient(app)


def test_place_order():
    res = client.post("/api/orders", json={"member_id": 1, "lines": [{"product_id": 10, "qty": 2}, {"product_id": 11, "qty": 1}, {"product_id": 12, "qty": 1}]})
    assert res.status_code == 200
    assert res.json()["status"] == "PARTIAL"


def test_member_grade():
    res = client.get("/api/members/2/grade")
    assert res.json() == {"id": 2, "grade": "SILVER"}
