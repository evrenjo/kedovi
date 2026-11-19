# 글쓰기 기준

채팅 답변, 사람이 읽는 문서, 환경 설정 주석에 같은 기준을 적용합니다. 에이전트는 이 기준으로 쓰고, 검사 도구는 어긋난 곳을 알립니다.

## 4대 원칙

| 원칙 | 기준 | 검사 |
|---|---|---|
| 두괄식 | 첫 줄에 결론이나 요청. 절차 문장만 조건을 먼저 씀 | 규칙으로 지킴 |
| 개조식 | 글머리 한 줄에 사실 하나. 끝은 명사형 | 긴 글머리, 한 글머리 여러 문장 |
| 간결성 | 한 문장에 정보 하나 | 긴 문장, 가운데점 나열, 긴 괄호 |
| 가독성 | 제목, 빈 줄, 표로 구조를 보여 줌 | 긴 단락 |

## 지나친 압축 방지

- 행위 주체가 모호하면 주어를 씀
- 명사를 셋 이상 잇지 않고 조사나 서술어를 넣음
- 「요망」 같은 줄인 말투 대신 할 일을 씀
- 번역 투 표현을 피함

## 환경 설정 주석

| 항목 | 기준 |
|---|---|
| 위치 | 키 바로 윗줄 |
| 첫 줄 | 이 값의 뜻 |
| 다음 줄 | 허용값, 기본값, 단위, 바꿀 때 영향 |
| 분량 | 한 줄에 한 문장 |
| 금지 | 비밀값, 작업 경위, 값 뒤 주석 |

```bash
kedovi draft config --file .env.example
```

코드 주석은 다른 기준을 씁니다. 코드에서 알 수 없는 이유와 제약만 적습니다.

## 검사 기준값

| 설정 | 기본값 | 뜻 |
|---|---|---|
| `vars.writing.sentenceMax` | 100 | 한 문장 글자 수 |
| `vars.writing.dotMax` | 3 | 한 문장의 가운데점 수 |
| `vars.writing.parenMax` | 40 | 괄호 안 글자 수 |
| `vars.writing.paragraphMax` | 400 | 한 단락 글자 수 |

이 항목은 알리기만 하고 막지 않습니다. 한국어 글자 수 기준은 공식 수치가 없어 킷이 정한 시작값입니다. 팀에 맞게 조정합니다.

> 출처: [쉬운 공공언어 쓰기 길잡이](https://korean.go.kr/common/download.do?c_file_name=901b4032-ae19-4457-87b7-e0f61c04378e.pdf&file_path=etcData&o_file_name=guide.pdf): 짧은 문장, 번역 투, 명사 나열
>
> 출처: [digital.gov 쉬운 글 안내](https://digital.gov/guides/plain-language/writing/clear-short): 한 문장 한 생각, 단락 길이
>
> 출처: [NN/g 웹 글 읽기 연구](https://www.nngroup.com/articles/how-users-read-on-the-web/): 결론 먼저, 훑기 쉬운 구조
>
> 출처: [Google 개발자 문서 스타일](https://developers.google.com/style/highlights): 조건을 지시보다 먼저
>
> 출처: [Google 코드 스타일](https://google.github.io/styleguide/cppguide.html): 주석은 이유를 설명
