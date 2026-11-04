package __BASE_PACKAGE__.writereport;

import java.util.List;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.test.context.ContextConfigurationAttributes;
import org.springframework.test.context.ContextCustomizer;
import org.springframework.test.context.ContextCustomizerFactory;
import org.springframework.test.context.MergedContextConfiguration;

/**
 * JDBC 판 등록기 (Spring JDBC · JdbcTemplate · JPA · MyBatis 등 DataSource 를 쓰는 모든 것).
 * test 리소스 META-INF/spring.factories 의 org.springframework.test.context.ContextCustomizerFactory 키로 붙는다.
 * 모든 Spring 시험 문맥(@SpringBootTest · @JdbcTest · @DataJpaTest 슬라이스 포함)에 DataSource 후처리기를 넣어,
 * 그 문맥의 DataSource 빈을 감싸고 문장을 기록한다. 운영 코드 · 설정은 바꾸지 않는다.
 */
public class WriteReportJdbc implements ContextCustomizerFactory {

    @Override
    public ContextCustomizer createContextCustomizer(Class<?> testClass, List<ContextConfigurationAttributes> configAttributes) {
        return new Customizer();
    }

    static final class Customizer implements ContextCustomizer {
        @Override
        public void customizeContext(ConfigurableApplicationContext context, MergedContextConfiguration mergedConfig) {
            WriteReportRecorder.stack("jdbc");
            context.getBeanFactory().addBeanPostProcessor(new WriteReportConnections.PostProcessor(context, true));
        }

        // 문맥 캐시 열쇠에 들어간다. 모든 시험에서 같아야 문맥 캐시가 쪼개지지 않는다
        @Override
        public boolean equals(Object o) {
            return o != null && o.getClass() == getClass();
        }

        @Override
        public int hashCode() {
            return Customizer.class.hashCode();
        }
    }
}
