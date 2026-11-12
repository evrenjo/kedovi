package com.example.shop.order;

import java.util.List;

public record OrderRequest(Long memberId, List<Line> lines) {
  public record Line(Long productId, int qty) {}
}
