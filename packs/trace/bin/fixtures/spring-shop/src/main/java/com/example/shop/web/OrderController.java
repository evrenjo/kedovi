package com.example.shop.web;

import com.example.shop.order.OrderRequest;
import com.example.shop.order.OrderResult;
import com.example.shop.order.OrderService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OrderController {
  private final OrderService orderService;

  public OrderController(OrderService orderService) {
    this.orderService = orderService;
  }

  @PostMapping("/api/orders")
  public ResponseEntity<OrderResult> place(@RequestBody OrderRequest request) {
    OrderResult result = orderService.place(request);
    return ResponseEntity.ok(result);
  }
}
