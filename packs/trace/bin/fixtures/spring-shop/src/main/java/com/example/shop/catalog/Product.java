package com.example.shop.catalog;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import java.math.BigDecimal;

@Entity
public class Product {
  @Id
  private Long id;
  private String name;
  private BigDecimal price;
  private int stock;

  protected Product() {}

  public String getName() { return name; }
  public BigDecimal getPrice() { return price; }
  public int getStock() { return stock; }

  public void decrease(int qty) {
    if (qty > stock) {
      throw new IllegalStateException("재고 부족: " + name);
    }
    stock -= qty;
  }
}
