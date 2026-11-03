---
title: Spring 이름·MapStruct·Javadoc
load: on-demand
when: Spring 백엔드에서 메서드 이름을 짓거나, MapStruct 변환을 쓰거나, Javadoc 을 달 때
---

## MapStruct

- 엔티티(jOOQ 면 model record) ↔ DTO 변환은 `@Mapper(componentModel = "spring")` 인터페이스로, 그 구조의 mapper 패키지에 둔다. 서비스에서 필드를 손으로 옮기지 않는다.
- 이름이 다른 필드·파생 값은 `@Mapping(target, source | expression)`, 채우지 않을 필드는 `ignore = true` 로 **명시**한다. 빌드 경고(unmapped target)를 무시하지 않는다.

## 메서드 이름 (레이어별 기본)

| 레이어 | 등록 | 수정 | 삭제 | 단건 | 목록 |
|---|---|---|---|---|---|
| Controller | `create{도메인}` | `modify{도메인}` | `delete{도메인}` | `find{도메인}` | `page{도메인}` / `cursor{도메인}` |
| Service | `create` | `modify` | `delete` | `get` + 용도 (`getDetail`) | `getPage` |
| Query | | | | `find` + 용도·조건 (`findDetail`) | `findPage`, `findCursorList` |
| Repository | Spring Data 규칙 (`findBy`·`existsBy`·`countBy`·`deleteBy`) | | | | |

## Javadoc

- 모든 public 클래스·메서드에 Javadoc, 분량은 backend 팩 상한. **평문**으로: `{@link}`·`@see`·`<p>`·`@param`·`@return`·`@throws` 를 쓰지 않는다.
- 애너테이션이 있는 클래스는 **첫 애너테이션 앞**에 둔다.

Java 일반 규칙(import·명명·선언 순서·포매터)은 `packs/stack-spring/docs/java-convention.md`.
버전을 올리거나 변경 기록을 쓸 때는 `packs/stack-spring/docs/versioning.md`.
