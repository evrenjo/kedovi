package __BASE_PACKAGE__.archrules;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.lang.CompositeArchRule;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * 패키지 구조 · 역할 클래스 규칙 (kedovi archrules 로 만든 파일, 프로젝트에 맞게 고쳐 쓴다).
 *
 * 설정 값 세 개(아래 상수)만 바꾸면 규칙 묶음이 바뀐다. 규칙을 하나 빼려면 rules() 에서 지운다.
 */
public final class ArchRules {

    /** 검사할 기준 패키지. */
    static final String BASE_PACKAGE = "__BASE_PACKAGE__";

    /** true = feature/<기능>/[<하위기능>/]<계층> 구조, false = 계층 먼저(webapi · service · query …). */
    static final boolean FEATURE_FIRST = __FEATURE_FIRST__;

    /** true = component-web: feature (진입점 없음) + web/views/<화면> · web/api/<묶음> 화면 API 층 (+ 선택 customer/<고객>). FEATURE_FIRST 가 true 여야 한다. */
    static final boolean COMPONENT_WEB = __COMPONENT_WEB__;

    /** true = 역할 클래스에 도우미 메서드 0개(접근 제한자 무관, 자기만 부르는 public 포함). */
    static final boolean NO_HELPER_METHODS = __NO_HELPER_METHODS__;

    /** 생성 코드 최상위 패키지 (검사하지 않는다). 예: jOOQ 생성 위치. */
    static final Set<String> GENERATED_TOP_PACKAGES = Set.of("jooq", "generated");

    /** 최상위는 feature · config · shared (component-web 이면 web · customer 도) 와 @SpringBootApplication 메인 클래스뿐이다. */
    static final ArchRule TOP_LEVEL_PACKAGES = classes()
            .that(PackageLayout.APP_CLASS)
            .should(PackageLayout.RESIDE_IN_ALLOWED_TOP_LEVEL)
            .because(COMPONENT_WEB ? "최상위는 feature/ · web/ · config/ · shared/ · customer/ 와 메인 클래스다" : "최상위는 feature/ · config/ · shared/ 와 메인 클래스다")
            .allowEmptyShould(true);

    /** 기능 안은 feature/<기능>/<계층> 또는 feature/<기능>/<하위기능>/<계층> 이고 계층 패키지가 끝이다. */
    static final ArchRule FEATURE_LAYER_PACKAGES = classes()
            .that(PackageLayout.APP_CLASS)
            .should(PackageLayout.HAVE_FEATURE_LAYER_PACKAGE)
            .because("기능 안은 파일 수와 관계없이 계층 하위 패키지에 두고, 하위 기능은 한 단계까지다")
            .allowEmptyShould(true);

    /** 이름 접미사가 정한 계층에 둔다 (*Controller → controller, *Repository → repository 등). */
    static final ArchRule SUFFIX_MATCHES_LAYER = classes()
            .that(PackageLayout.APP_CLASS)
            .should(PackageLayout.RESIDE_IN_LAYER_OF_SUFFIX)
            .because("이름 접미사와 계층 패키지가 같은 뜻이어야 위치로 역할을 찾는다")
            .allowEmptyShould(true);

    /** 다른 기능은 service · model · dto · exception 만 참조한다. 하위 기능은 자기 상위 기능의 모든 계층을 참조한다. */
    static final ArchRule FEATURE_BOUNDARIES = classes()
            .that(featureClasses())
            .should(FeatureBoundaries.ONLY_USE_PUBLIC_LAYERS_OF_OTHER_FEATURES)
            .because("repository · client · mapper · controller · websocket · messaging · job · config 는 기능 내부다")
            .allowEmptyShould(true);

    /** 최상위 config · shared 는 feature 를 참조하지 않는다. */
    static final ArchRule CONFIG_AND_SHARED_DO_NOT_DEPEND_ON_FEATURE = classes()
            .that(DescribedPredicate.describe(
                    "최상위 config · shared 의 클래스",
                    (JavaClass javaClass) -> PackageLocation.of(javaClass.getPackageName())
                            .filter(PackageLocation::isConfigOrShared)
                            .isPresent()))
            .should(FeatureBoundaries.NOT_DEPEND_ON_FEATURE)
            .because("전역 설정 · 공통 코드가 기능을 알면 기능을 옮기거나 지울 때 전역이 깨진다")
            .allowEmptyShould(true);

    /** component-web: web 안은 web/views/<화면 경로>/<계층> · web/api/<묶음>/<계층> 이다. */
    static final ArchRule WEB_LAYER_PACKAGES = classes()
            .that(PackageLayout.APP_CLASS)
            .should(PackageLayout.HAVE_WEB_LAYER_PACKAGE)
            .because("화면 하나 = 프론트 화면 폴더 하나 = web/views/<화면 경로> 하나다")
            .allowEmptyShould(true);

    /** component-web: 기능 안에는 진입점(controller · websocket)을 두지 않는다. */
    static final ArchRule NO_ENTRY_IN_FEATURE = classes()
            .that(PackageLayout.APP_CLASS)
            .should(PackageLayout.NOT_BE_ENTRY_IN_FEATURE)
            .because("HTTP 진입점은 화면 기준 web 층에 둔다. 기능은 업무 로직 · 저장소만 갖는다")
            .allowEmptyShould(true);

    /** component-web: web 은 기능의 service · model · dto · exception 만 참조한다. */
    static final ArchRule WEB_USES_PUBLIC_FEATURE_LAYERS = classes()
            .that(webClasses())
            .should(FeatureBoundaries.ONLY_USE_PUBLIC_LAYERS_OF_OTHER_FEATURES)
            .because("화면 API 는 기능의 서비스를 부르고 저장소 · 클라이언트를 직접 쓰지 않는다")
            .allowEmptyShould(true);

    /** component-web: feature 는 web 을 참조하지 않는다. */
    static final ArchRule FEATURE_DOES_NOT_DEPEND_ON_WEB = classes()
            .that(DescribedPredicate.describe(
                    "feature 의 클래스",
                    (JavaClass javaClass) -> PackageLocation.of(javaClass.getPackageName()).filter(PackageLocation::isFeature).isPresent()))
            .should(FeatureBoundaries.NOT_DEPEND_ON_WEB)
            .because("화면이 바뀌어도 기능은 그대로여야 한다 (방향은 web → feature → shared)")
            .allowEmptyShould(true);

    /** component-web: 화면 · API 묶음끼리 참조하지 않는다. */
    static final ArchRule WEB_UNITS_ARE_INDEPENDENT = classes()
            .that(webClasses())
            .should(FeatureBoundaries.NOT_DEPEND_ON_OTHER_WEB_UNITS)
            .because("화면 하나를 고치거나 지울 때 다른 화면이 깨지지 않게 한다")
            .allowEmptyShould(true);

    /** component-web: 공통 코드는 customer 를 참조하지 않고, 고객사끼리도 참조하지 않는다. */
    static final ArchRule COMMON_DOES_NOT_DEPEND_ON_CUSTOMER = classes()
            .that(PackageLayout.APP_CLASS)
            .should(FeatureBoundaries.NOT_DEPEND_ON_OTHER_CUSTOMER)
            .because("고객사 코드를 지워도 공통은 그대로여야 한다")
            .allowEmptyShould(true);

    /** 역할 클래스에는 도우미 메서드가 0개다 (private · protected · package-private · 자기만 부르는 public). */
    static final ArchRule ROLE_CLASSES_HAVE_NO_HELPER_METHODS = classes()
            .that(RoleClasses.ROLE_CLASS)
            .should(RoleClassConditions.HAVE_NO_HELPER_METHODS)
            .because("역할 클래스에는 역할 메서드 · 주입 필드 · Logger 만 둔다. 계산 · 변환 · 검증은 하는 일 이름의 클래스로 뺀다"
                    + " (생성자 · @Bean · @Scheduled · 리스너 · @ExceptionHandler · 핸들러 매핑 · 오버라이드는 예외)")
            .allowEmptyShould(true);

    /** 역할 클래스의 static 필드는 Logger 만이다. */
    static final ArchRule ROLE_CLASSES_HAVE_ONLY_LOGGER_STATIC_FIELDS = classes()
            .that(RoleClasses.ROLE_CLASS)
            .should(RoleClassConditions.HAVE_ONLY_LOGGER_STATIC_FIELDS)
            .because("닫힌 값 묶음 = enum, 환경값 = *Properties, 그 밖 = model 의 이름 있는 상수 클래스")
            .allowEmptyShould(true);

    /** 역할 클래스 안에 중첩 타입(클래스 · record · enum · 인터페이스)을 두지 않는다. 익명 · 지역 클래스는 대상이 아니다. */
    static final ArchRule ROLE_CLASSES_HAVE_NO_NESTED_TYPES = classes()
            .should(RoleClassConditions.NOT_BE_NESTED_IN_ROLE_CLASS)
            .because("요청 · 응답 · 값 타입은 dto · model 계층의 클래스로 둔다")
            .allowEmptyShould(true);

    /** 클래스 이름 끝과 기준 패키지 아래 패키지 이름에 Util · Helper · Common · Support · Manager 를 쓰지 않는다. */
    static final ArchRule NO_GENERIC_NAMES = noClasses()
            .that(GenericNames.APP_CLASS)
            .should(GenericNames.HAVE_GENERIC_NAME)
            .because("범용 이름은 경계가 틀렸다는 신호다. Validator · Calculator · Mapper 처럼 하는 일로 짓는다")
            .allowEmptyShould(true);

    /** static 이 아닌 필드는 private 이다 (final 은 강제하지 않는다). */
    static final ArchRule INSTANCE_FIELDS_ARE_PRIVATE = noClasses()
            .that(InstanceFields.CHECKED_CLASS)
            .should(InstanceFields.HAVE_NON_PRIVATE_INSTANCE_FIELD)
            .because("인스턴스 필드는 private (가능하면 private final). 접근은 메서드로 연다")
            .allowEmptyShould(true);

    private ArchRules() {}

    /** 설정 값에 따라 켜진 규칙 목록. */
    static List<ArchRule> rules() {
        List<ArchRule> rules = new ArrayList<>();
        if (FEATURE_FIRST) {
            rules.add(TOP_LEVEL_PACKAGES);
            rules.add(FEATURE_LAYER_PACKAGES);
            rules.add(FEATURE_BOUNDARIES);
            rules.add(CONFIG_AND_SHARED_DO_NOT_DEPEND_ON_FEATURE);
        }
        if (FEATURE_FIRST && COMPONENT_WEB) {
            rules.add(WEB_LAYER_PACKAGES);
            rules.add(NO_ENTRY_IN_FEATURE);
            rules.add(WEB_USES_PUBLIC_FEATURE_LAYERS);
            rules.add(FEATURE_DOES_NOT_DEPEND_ON_WEB);
            rules.add(WEB_UNITS_ARE_INDEPENDENT);
            rules.add(COMMON_DOES_NOT_DEPEND_ON_CUSTOMER);
        }
        rules.add(SUFFIX_MATCHES_LAYER);
        if (NO_HELPER_METHODS) {
            rules.add(ROLE_CLASSES_HAVE_NO_HELPER_METHODS);
        }
        rules.add(ROLE_CLASSES_HAVE_ONLY_LOGGER_STATIC_FIELDS);
        rules.add(ROLE_CLASSES_HAVE_NO_NESTED_TYPES);
        rules.add(NO_GENERIC_NAMES);
        rules.add(INSTANCE_FIELDS_ARE_PRIVATE);
        return rules;
    }

    /**
     * feature/featureName 는 다른 기능을 전혀 참조하지 않는다 (공개 계층 포함). 따로 떼어 낼 기능에 쓴다:
     * ArchRules.check(ArchRules.isolatedFeature("billing")).
     */
    static ArchRule isolatedFeature(String featureName) {
        return classes()
                .that(DescribedPredicate.describe(
                        "feature/" + featureName + " 의 클래스",
                        (JavaClass javaClass) -> PackageLocation.of(javaClass.getPackageName())
                                .flatMap(PackageLocation::featureName)
                                .filter(featureName::equals)
                                .isPresent()))
                .should(FeatureBoundaries.notDependOnOtherFeatures(featureName))
                .because("feature/" + featureName + " 는 독립 패키지다. 다른 기능과의 연동은 이 기능이 정한 인터페이스를 다른 기능이 구현한다")
                .allowEmptyShould(true);
    }

    /** 테스트 클래스를 뺀 기준 패키지 아래 클래스에 켜진 규칙과 additionalRules 를 검사한다. 어기면 AssertionError. */
    static void check(ArchRule... additionalRules) {
        check(
                new ClassFileImporter()
                        .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                        .importPackages(BASE_PACKAGE),
                additionalRules);
    }

    static void check(JavaClasses classes, ArchRule... additionalRules) {
        List<ArchRule> all = rules();
        all.addAll(List.of(additionalRules));
        CompositeArchRule rule = CompositeArchRule.of(all.get(0));
        for (ArchRule next : all.subList(1, all.size())) {
            rule = rule.and(next);
        }
        rule.check(classes);
    }

    static DescribedPredicate<JavaClass> webClasses() {
        return DescribedPredicate.describe(
                "web/… 의 클래스",
                (JavaClass javaClass) -> PackageLocation.of(javaClass.getPackageName())
                        .flatMap(PackageLocation::webUnit)
                        .isPresent());
    }

    static DescribedPredicate<JavaClass> featureClasses() {
        return DescribedPredicate.describe(
                "feature/<기능>/… 의 클래스",
                (JavaClass javaClass) -> PackageLocation.of(javaClass.getPackageName())
                        .flatMap(PackageLocation::featureUnit)
                        .isPresent());
    }
}
