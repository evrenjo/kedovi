package __BASE_PACKAGE__.archrules;

import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.JavaClass;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * 역할 클래스. Spring 클래스를 직접 쓰지 않고 어노테이션 이름으로 찾는다.
 *
 * 대상: @Service · @Controller(@RestController) · @Repository · @ControllerAdvice, 이름 끝 Repository · Query · Store, 역할 계층의
 * @Component, @RabbitListener · @Scheduled 를 가진 클래스. service 계층 @Component 중 이름이 HELPER_SUFFIXES 로 끝나는 빈은 도우미를
 * 빼 두는 자리라 대상이 아니다. mapper 계층(MapStruct)과 생성 코드는 대상이 아니다.
 */
final class RoleClasses {

    static final String SERVICE = "org.springframework.stereotype.Service";
    static final String CONTROLLER = "org.springframework.stereotype.Controller";
    static final String REPOSITORY = "org.springframework.stereotype.Repository";
    static final String COMPONENT = "org.springframework.stereotype.Component";
    static final String CONTROLLER_ADVICE = "org.springframework.web.bind.annotation.ControllerAdvice";
    static final String RABBIT_LISTENER = "org.springframework.amqp.rabbit.annotation.RabbitListener";
    static final String RABBIT_LISTENERS = "org.springframework.amqp.rabbit.annotation.RabbitListeners";
    static final String KAFKA_LISTENER = "org.springframework.kafka.annotation.KafkaListener";
    static final String SCHEDULED = "org.springframework.scheduling.annotation.Scheduled";
    // 한 메서드에 여럿 달면 컴파일러가 묶음 어노테이션으로 바꾼다.
    static final String SCHEDULES = "org.springframework.scheduling.annotation.Schedules";

    static final List<String> ROLE_ANNOTATIONS = List.of(SERVICE, CONTROLLER, REPOSITORY, CONTROLLER_ADVICE);
    static final List<String> ROLE_SUFFIXES = List.of("Repository", "Query", "Store");

    /** @Component 가 역할 클래스가 되는 계층 (feature-first 계층 이름과 계층 먼저 구조의 최상위 이름). */
    static final Set<String> COMPONENT_ROLE_LAYERS =
            Set.of("controller", "websocket", "messaging", "job", "repository", "service", "webapi", "query");

    static final String SERVICE_LAYER = "service";

    /** service 계층 @Component 중 역할 클래스에서 빼는 이름 끝 (계산 · 변환 · 검증을 빼 두는 도우미 빈). 프로젝트에 맞게 더한다. */
    static final List<String> HELPER_SUFFIXES = List.of(
            "Validator",
            "Calculator",
            "Parser",
            "Formatter",
            "Policy",
            "Resolver",
            "Matcher",
            "Hasher",
            "Converter",
            "Verifier",
            "Classifier",
            "Generator");

    static final List<String> ROLE_METHOD_ANNOTATIONS =
            List.of(RABBIT_LISTENER, RABBIT_LISTENERS, KAFKA_LISTENER, SCHEDULED, SCHEDULES);

    static final DescribedPredicate<JavaClass> ROLE_CLASS = DescribedPredicate.describe(
            "역할 클래스 (@Service · @Controller · @Repository · *Query · *Store · 리스너 등)", RoleClasses::isRoleClass);

    private RoleClasses() {}

    static boolean isRoleClass(JavaClass javaClass) {
        Optional<PackageLocation> location = PackageLocation.of(javaClass.getPackageName());
        if (location.isEmpty() || location.get().isGenerated() || !javaClass.isTopLevelClass()) {
            return false;
        }
        return ROLE_ANNOTATIONS.stream().anyMatch(annotation -> annotated(javaClass, annotation))
                || ROLE_SUFFIXES.stream().anyMatch(javaClass.getSimpleName()::endsWith)
                || (annotated(javaClass, COMPONENT)
                        && location.flatMap(PackageLocation::layer)
                                .filter(COMPONENT_ROLE_LAYERS::contains)
                                .filter(layer -> !layer.equals(SERVICE_LAYER) || !isHelperBean(javaClass))
                                .isPresent())
                || annotated(javaClass, RABBIT_LISTENER)
                || javaClass.getMethods().stream()
                        .anyMatch(method -> ROLE_METHOD_ANNOTATIONS.stream()
                                .anyMatch(annotation -> method.isAnnotatedWith(annotation) || method.isMetaAnnotatedWith(annotation)));
    }

    static boolean isHelperBean(JavaClass javaClass) {
        return HELPER_SUFFIXES.stream().anyMatch(javaClass.getSimpleName()::endsWith);
    }

    static boolean annotated(JavaClass javaClass, String annotation) {
        return javaClass.isAnnotatedWith(annotation) || javaClass.isMetaAnnotatedWith(annotation);
    }
}
