# 클린 코드 규칙

repo 에 감지된 언어마다 클린 코드 규칙이 붙는다. 언어 공통 규칙(`clean-code`)과 언어별 규칙(`lang-*`), 프레임워크별 레이어 책임 규칙(스택 팩)이 함께 걸린다.
모든 규칙은 **그 repo 의 기존 관례 · 포매터 · 린터 설정이 먼저**이고, 관례가 없을 때의 기본값이다.

## 붙는 규칙

| repo 에 있는 것 | 붙는 팩 | 핵심 |
|---|---|---|
| 감지된 언어가 하나라도 (TypeScript · JavaScript · Go · C# 포함) | `clean-code` | 온전한 낱말 이름 · 한 문장으로 설명되는 함수 · 왜만 쓰는 주석 · 레이어 파일에 도우미 메서드(접근 제한자 무관) · 상수 늘어놓지 않기 (기준은 vars.cleanCode.helperMethods) · 공통 로직 위치와 이름 |
| Java · Kotlin | `lang-java` · `lang-kotlin` | 이름 · 메서드 · record · sealed · Javadoc · KDoc · 스코프 함수 |
| Python | `lang-python` | PEP 8 · 타입 힌트 · docstring · 예외. ML · AI 코드는 작업할 때 읽는 규칙 |
| C · C++ | `lang-c` · `lang-cpp` | 반환값 확인 · 정리 경로 · RAII · 소유권 · const · 오류 방식 하나 |
| Swift · Dart | `lang-swift` · `lang-dart` | 문장처럼 읽히는 이름 · 인자 레이블 · 동시성 · Effective Dart |
| Spring · NestJS · React · Next.js | 스택 팩의 레이어 책임 규칙 | 컨트롤러 · 서비스 · 모듈 · 컴포넌트 · 라우트가 하는 일, 꺼낸 로직의 위치 · 이름 |
| FastAPI · Django · Android · Flutter | `stack-fastapi` · `stack-django` · `stack-android` · `stack-flutter` | 프레임워크 구조 · 로직 위치 |

## repo 마다 다르게

| 하고 싶은 것 | 방법 |
|---|---|
| 한 repo 에서 언어 규칙 끄기 | `kedovi rules off lang-java--10-java --repo <이름>` |
| 한 repo 만 우리 규칙으로 | `packs/project/rules/<이름>.md` 머리말에 `replaces: lang-java--10-java` + `repos: <이름>` |
| 모든 repo 를 우리 규칙으로 | 위에서 `repos:` 를 뺀다 |

자세한 형식은 [팩 제작](pack-making.md).

## 검사 도구

규칙 문장보다 도구가 확실하다. repo 에 설정이 있으면 에이전트가 고친 뒤 돌리고, 없으면 새로 만들지 않고 제안만 한다.

| 언어 | 포매터 | 정적 분석 |
|---|---|---|
| Java | Spotless (google-java-format) | Checkstyle · PMD · Error Prone · NullAway |
| Kotlin | ktlint | detekt (Compose 는 compose-rules) |
| Python | ruff format | ruff check · mypy · pyright |
| C · C++ | clang-format | clang-tidy · cppcheck · ASan · UBSan |
| Swift | swift-format · SwiftFormat | SwiftLint |
| Dart · Flutter | dart format | dart analyze (lints · flutter_lints) |
| TypeScript | prettier 등 repo 설정 | ESLint (max-lines · complexity · import 경계) |

## 근거

> 규칙마다 아래 출처를 대조해 정했다. 출처끼리 다른 곳(함수 크기 · 주석 · 예외 · 이름 꼴)은 AI 가 기계적으로 과하게 적용하지 않는 쪽을 기본값으로 골랐다.

| 범위 | 출처 |
|---|---|
| 언어 공통 | Ousterhout · Martin 「APOSD vs Clean Code」 토론(2025) · A Philosophy of Software Design 2판 · Beck「Tidy First?」 · Fowler「Refactoring」 2판 · Hofmeister 2017(짧은 이름이 이해를 늦춤) · Schankin 2018 · Feitelson 2021 · Radmanesh 2024(코드와 어긋난 주석과 버그) · Rani 2023 · Google eng-practices · GitClear 2025(AI 코드 중복) · Anthropic Claude Code best practices |
| 레이어 책임 | Spring Boot 「Structuring Your Code」 · Spring Modulith · Fowler「Anemic Domain Model」 · Hombergs「Get Your Hands Dirty on Clean Architecture」 · NestJS Modules · Providers · React「Reusing Logic with Custom Hooks」 · 「You Might Not Need an Effect」 · Bulletproof React · Kent C. Dodds「Colocation」 · Next.js Project Structure · Data Security · Sandi Metz「The Wrong Abstraction」 |
| Java · Kotlin · Spring | Google Java Style Guide · Effective Java 3판 · OpenJDK LVTI 가이드 · JEP 395 · 409 · 440 · 441 · 네이버 핵데이 Java 컨벤션 · Kotlin Coding Conventions · Idioms · KDoc · Effective Kotlin 2판 · Spring Boot 「Spring Beans and Dependency Injection」 |
| Python · ML · FastAPI · Django | PEP 8 · 20 · 257 · 484 · 604 · Google Python Style Guide · Effective Python 3판 · Rules of ML · Sculley 2015「Hidden Technical Debt in ML Systems」 · Zhang 2022「Code Smells for ML Applications」 · Pimentel 2019(노트북 재현성) · FastAPI 공식 문서 · fastapi-best-practices · Django Coding Style · Design Philosophies · HackSoft Django Styleguide |
| C · C++ | C++ Core Guidelines · Google C++ Style Guide · LLVM Coding Standards · Effective Modern C++ · Linux kernel coding style · SEI CERT C · C++ · Holzmann 2006「Power of Ten」 · BARR-C:2018 · MISRA 공개 원칙 · NSA · CISA 메모리 안전 지침(2025) |
| Swift · Android · Dart · Flutter | Swift API Design Guidelines · DocC · Google · Airbnb · Kodeco Swift Style Guide · Android Architecture recommendations · Compose API guidelines · Now in Android · Effective Dart · Flutter App architecture guide · Performance best practices |
