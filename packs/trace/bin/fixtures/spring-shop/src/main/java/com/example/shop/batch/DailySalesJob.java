package com.example.shop.batch;

import com.example.shop.order.OrderRepository;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class DailySalesJob {
  private final OrderRepository orders;

  public DailySalesJob(OrderRepository orders) {
    this.orders = orders;
  }

  public Map<LocalDate, BigDecimal> run(LocalDate from, int days) {
    Map<LocalDate, BigDecimal> report = new LinkedHashMap<>();
    for (int i = 0; i < days; i++) {
      LocalDate day = from.plusDays(i);
      report.put(day, orders.totalOn(day));
    }
    return report;
  }
}
