package __BASE_PACKAGE__.archrules;

import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;
import java.util.List;
import java.util.Locale;

/** 무엇이든 넣는 이름 금지: 클래스 이름 끝과 기준 패키지 아래 패키지 이름. */
final class GenericNames {

    static final List<String> FORBIDDEN = List.of("util", "utils", "helper", "helpers", "common", "support", "manager");

    static final DescribedPredicate<JavaClass> APP_CLASS = DescribedPredicate.describe(
            "기준 패키지 아래 클래스 (생성 코드 제외)",
            javaClass -> PackageLocation.of(javaClass.getPackageName())
                    .filter(location -> !location.isGenerated())
                    .isPresent());

    static final ArchCondition<JavaClass> HAVE_GENERIC_NAME =
            new ArchCondition<>("클래스 이름 끝 · 패키지에 Util · Helper · Common · Support · Manager 를 쓴다") {
                @Override
                public void check(JavaClass javaClass, ConditionEvents events) {
                    String forbiddenSuffix = forbiddenSuffix(javaClass.getSimpleName());
                    if (forbiddenSuffix != null) {
                        events.add(SimpleConditionEvent.satisfied(
                                javaClass, javaClass.getName() + " 의 이름 끝이 금지 이름 '" + forbiddenSuffix + "' 다"));
                    }
                    String forbiddenPackage = PackageLocation.of(javaClass.getPackageName())
                            .flatMap(location -> location.rest().stream()
                                    .filter(segment -> FORBIDDEN.contains(segment.toLowerCase(Locale.ROOT)))
                                    .findFirst())
                            .orElse(null);
                    if (forbiddenPackage != null) {
                        events.add(SimpleConditionEvent.satisfied(
                                javaClass, javaClass.getName() + " 가 금지 이름 패키지 '" + forbiddenPackage + "' 에 있다"));
                    }
                }
            };

    private GenericNames() {}

    static String forbiddenSuffix(String simpleName) {
        String lower = simpleName.toLowerCase(Locale.ROOT);
        return FORBIDDEN.stream().filter(lower::endsWith).findFirst().orElse(null);
    }
}
