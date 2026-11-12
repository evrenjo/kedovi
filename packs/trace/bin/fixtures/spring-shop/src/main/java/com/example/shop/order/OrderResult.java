package com.example.shop.order;

import java.math.BigDecimal;
import java.util.List;

public record OrderResult(Long orderId, BigDecimal total, OrderStatus status, List<String> skipped) {}
