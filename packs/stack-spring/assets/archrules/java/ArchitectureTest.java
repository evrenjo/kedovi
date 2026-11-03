package __BASE_PACKAGE__.archrules;

import org.junit.jupiter.api.Test;

/** 패키지 구조 · 역할 클래스 규칙 검사. 실패 메시지가 어긴 클래스 · 메서드와 고칠 곳을 알려 준다. 설정은 ArchRules 의 상수. */
class ArchitectureTest {

    @Test
    void architecture() {
        ArchRules.check();
    }
}
