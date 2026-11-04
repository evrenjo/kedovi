package __BASE_PACKAGE__.writereport;

import org.springframework.test.context.TestContext;
import org.springframework.test.context.support.AbstractTestExecutionListener;

/**
 * 시험 경계. test 리소스 META-INF/spring.factories 의 org.springframework.test.context.TestExecutionListener 키로 붙는다.
 *
 * 순서: beforeTestExecution 에서 구간을 열고(@BeforeEach 준비 쓰기 제외) afterTestExecution 에서 닫는다.
 * 원본 YAML 은 afterTestMethod 에서 쓴다. 순서값 3500 은 TransactionalTestExecutionListener(4000) 보다 작아서,
 * after 콜백이 거꾸로 도는 Spring 규칙상 @Transactional 시험의 롤백이 끝난 뒤에 불린다 (롤백 표시가 빠지지 않는다).
 */
public class WriteReportListener extends AbstractTestExecutionListener {

    public static final int ORDER = 3500;

    @Override
    public int getOrder() {
        return ORDER;
    }

    @Override
    public void beforeTestExecution(TestContext testContext) {
        WriteReportRecorder.open(testContext);
    }

    @Override
    public void afterTestExecution(TestContext testContext) {
        WriteReportRecorder.close(testContext);
    }

    @Override
    public void afterTestMethod(TestContext testContext) {
        WriteReportRecorder.finish(testContext);
    }
}
