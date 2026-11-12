package com.example.shop.member;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;

@Entity
public class Member {
  @Id
  private Long id;
  private String name;
  private String grade;
  private String password;

  protected Member() {}

  public Long getId() { return id; }
  public String getGrade() { return grade; }
}
