package com.example.shop;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.shop.batch.DailySalesJob;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
class OrderApiTraceTest {
  @Autowired MockMvc mvc;
  @Autowired DailySalesJob job;

  @Test
  void placeOrder() throws Exception {
    String body = "{\"memberId\":1,\"lines\":[{\"productId\":10,\"qty\":2},{\"productId\":11,\"qty\":1},{\"productId\":12,\"qty\":1}]}";
    MvcResult result = mvc.perform(post("/api/orders").contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isOk())
        .andReturn();
    System.out.println(result.getResponse().getContentAsString());
  }

  @Test
  void dailySales() {
    var report = job.run(LocalDate.now().minusDays(2), 3);
    System.out.println(report);
  }
}
