---
title: Spring 패키지 구조 (기능 먼저)
load: on-demand
when: Spring 백엔드에 클래스·패키지를 새로 만들거나 옮기거나, 다른 기능의 클래스를 참조할 때
if: vars.spring.packageLayout=feature-first
---

## 패키지 구조 (기능 먼저, `{{ws:vars.spring.basePackage}}`)

계층·이름 원칙은 backend 팩, 메서드 이름 · MapStruct · Javadoc 은 「Spring 이름·MapStruct·Javadoc」.
**기존 코드가 다른 구조면 그것이 우선이다.** 옮기는 것은 사용자와 범위를 정한 뒤에만.

```
<기준 패키지>/
  <메인 클래스>Application.java     @SpringBootApplication 만
  feature/<기능>/<계층>/
  feature/<기능>/<하위기능>/<계층>/  하위 기능은 한 단계까지
  config/                          전역 설정
  shared/<개념>/                    여러 기능이 쓰는 개념 (time · web · socket …)
```

- 기준 패키지 바로 아래는 `feature` · `config` · `shared` 와 메인 클래스뿐이다 (생성 코드 패키지 예외).
- **기능 안은 파일 수와 관계없이 계층 패키지에 둔다.** 계층은 12개이고 계층 아래에 패키지를 더 두지 않는다.

| 계층 | 담는 것 | 이름 끝 |
|---|---|---|
| `controller` | HTTP 진입점 | `*Controller` |
| `websocket` | 웹소켓 핸들러 | `*Handler` |
| `messaging` | 메시지 수신 · 발행 | `*Listener` · `*Publisher` |
| `job` | 예약 · 배치 작업 | `*Job` |
| `service` | 유스케이스 · 트랜잭션 경계, 계산 · 검증 도우미 빈 | `*Service` · `*Calculator` · `*Validator` … |
| `model` | 도메인 값 · 엔티티 · enum · 이름 있는 상수 | 접미사 없음 |
| `repository` | 데이터 접근 | `*Repository` · `*Query` · `*Store` |
| `dto` | 요청 · 응답 | `*Request` · `*Response` |
| `mapper` | MapStruct 변환 | `*Mapper` |
| `client` | 외부 API 호출 | `*Client` |
| `exception` | 예외 · 오류 코드 | `*Exception` · `*ErrorCode` |
| `config` | 그 기능 전용 설정 | `*Configuration` · `*Properties` |

## 기능 경계

- **다른 기능은 `service` · `model` · `dto` · `exception` 만 참조한다.** 나머지 계층은 그 기능 내부다. 하위 기능끼리 · 상위 → 하위도 같다.
- **하위 기능은 자기 상위 기능의 모든 계층을 참조한다** (기능 전체 설정 · 예외를 쓴다).
- 최상위 `config` · `shared` 는 `feature` 를 참조하지 않는다. 기능을 알아야 하면 그 코드는 기능 안에 둔다.
- 따로 떼어 낼 기능은 다른 기능을 전혀 모르게 둔다 (연동은 그 기능이 정한 인터페이스를 다른 기능이 구현한다).

## 데이터 접근이 jOOQ 일 때

- 엔티티가 없다. 테이블 값은 `model` 의 record · 값 객체로 둔다.
- `repository` 의 `*Query` 는 `model` record 를 돌려준다. 생성 코드의 `*Record` · 테이블 클래스는 repository 밖으로 내보내지 않는다.
- `model` ↔ `dto` 변환은 MapStruct `*Mapper` 로. 생성 코드 패키지는 검사 · 이름 규칙 대상이 아니다.

## 검사 장치

`kedovi archrules spring` 이 위 규칙(패키지 배치 · 접미사 → 계층 · 기능 경계 · 역할 클래스 · static 은 Logger 만 · 중첩 타입 금지 · 인스턴스 필드 private)을 ArchUnit 테스트 하나로 넣는다. 룰 문장만으로 지키게 하지 않는다. 테스트가 실패하면 메시지가 고칠 곳을 알려 준다.
