---
title: Spring 패키지 구조 (계층 먼저)
load: on-demand
when: Spring 백엔드에 클래스·패키지를 새로 만들거나 옮길 때
if: vars.spring.packageLayout!=feature-first
---

계층·소유자 이름·주석 분량 원칙은 backend 팩 「백엔드 계층·이름·주석」. 여기는 Spring 에서의 기본 모양이다 (`vars.spring.packageLayout = layer-first`).
**프로젝트가 이미 다른 구조·이름을 쓰면 그것이 우선이다.** 이 표에 맞추려고 기존 코드를 옮기지 않는다.
메서드 이름 · MapStruct · Javadoc 은 「Spring 이름·MapStruct·Javadoc」.

## 패키지 구조 (`{{ws:vars.spring.basePackage}}`)

| 패키지 | 역할 | 이름 |
|--------|------|------|
| `webapi/{도메인}/v1/` | `@RestController` | `*Api` |
| `webapi/{도메인}/v1/form/` | 요청 입력 (독립 클래스, inner class 아님) | `*Form` |
| `service/{도메인}/` | 비즈니스 로직 | `*Service` |
| `query/{도메인}/` | QueryDSL 동적 쿼리 (class) | `*Query` |
| `repository/{도메인}/` | Spring Data JPA (interface) | `*Repository` |
| `mapper/{도메인}/` | MapStruct 엔티티 ↔ DTO | `*Mapper` |
| `model/entity/{도메인}/` | JPA 엔티티 | 접미사 없음 |
| `model/base/` | 공통 감사 컬럼 (`@MappedSuperclass`) | `BaseEntity` |
| `model/dto/{도메인}/` | 응답·프로젝션 DTO | `*Dto` |
| `model/type/{도메인}/` | enum 상수 | `*Type` |
| `config/{역할}/` | 설정 (`jpa`·`security`·`web` …) | `*Config` |

- 엔티티 연관은 `@ManyToOne`/`@OneToMany` 대신 **plain FK 필드**(`UUID orderId`)로 두고, 조인은 QueryDSL `on()` 으로 명시한다. 지연 로딩·N+1·순환 참조가 조회 코드에서 보이게 한다. 프로젝트가 연관 매핑을 쓰고 있으면 그대로 따른다.
- 엔티티 필드·컬럼은 풀네임: `descriptionContent` ↔ `@Column(name = "description_content")`.
- 기능 단위로 묶는 구조를 쓰려면 `workspace.json` `vars.spring.packageLayout` 을 `feature-first` 로 (「Spring 패키지 구조 (기능 먼저)」).
- **검사는 장치로:** 접미사 → 패키지 · 역할 클래스 규칙은 `kedovi archrules spring` 이 ArchUnit 테스트로 넣는다. 룰 문장만으로 지키게 하지 않는다.
