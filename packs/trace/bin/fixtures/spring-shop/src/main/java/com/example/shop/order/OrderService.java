package com.example.shop.order;

import com.example.shop.catalog.Product;
import com.example.shop.catalog.ProductRepository;
import com.example.shop.member.Member;
import com.example.shop.member.MemberRepository;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderService {
  private final MemberRepository members;
  private final ProductRepository products;
  private final OrderRepository orders;

  public OrderService(MemberRepository members, ProductRepository products, OrderRepository orders) {
    this.members = members;
    this.products = products;
    this.orders = orders;
  }

  @Transactional
  public OrderResult place(OrderRequest request) {
    Member member = members.findById(request.memberId()).orElseThrow();
    BigDecimal total = BigDecimal.ZERO;
    List<String> skipped = new ArrayList<>();
    for (OrderRequest.Line line : request.lines()) {
      Product product = products.findById(line.productId()).orElseThrow();
      if (product.getStock() < line.qty()) {
        skipped.add(product.getName());
        continue;
      }
      product.decrease(line.qty());
      total = total.add(product.getPrice().multiply(BigDecimal.valueOf(line.qty())));
    }
    BigDecimal paid = discount(member, total);
    OrderStatus status = skipped.isEmpty() ? OrderStatus.PLACED : OrderStatus.PARTIAL;
    PurchaseOrder saved = orders.save(new PurchaseOrder(member.getId(), paid, status, LocalDate.now()));
    return new OrderResult(saved.getId(), paid, status, skipped);
  }

  BigDecimal discount(Member member, BigDecimal total) {
    if ("GOLD".equals(member.getGrade())) {
      BigDecimal rate = new BigDecimal("0.10");
      return total.subtract(total.multiply(rate));
    }
    return total;
  }
}
