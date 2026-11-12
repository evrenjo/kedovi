package com.example.shop.order;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import java.math.BigDecimal;
import java.time.LocalDate;

@Entity
public class PurchaseOrder {
  @Id @GeneratedValue
  private Long id;
  private Long memberId;
  private BigDecimal total;
  @Enumerated(EnumType.STRING)
  private OrderStatus status;
  private LocalDate orderedOn;

  protected PurchaseOrder() {}

  public PurchaseOrder(Long memberId, BigDecimal total, OrderStatus status, LocalDate orderedOn) {
    this.memberId = memberId;
    this.total = total;
    this.status = status;
    this.orderedOn = orderedOn;
  }

  public Long getId() { return id; }
  public BigDecimal getTotal() { return total; }
}
