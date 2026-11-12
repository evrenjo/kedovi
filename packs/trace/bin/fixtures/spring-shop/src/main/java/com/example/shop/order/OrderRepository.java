package com.example.shop.order;

import java.math.BigDecimal;
import java.time.LocalDate;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface OrderRepository extends JpaRepository<PurchaseOrder, Long> {
  @Query("select coalesce(sum(o.total), 0) from PurchaseOrder o where o.orderedOn = ?1")
  BigDecimal totalOn(LocalDate day);
}
