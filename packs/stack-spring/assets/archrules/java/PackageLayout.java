package __BASE_PACKAGE__.archrules;

import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/** 패키지 모양: 최상위 구분 · 기능/계층 깊이 · 접미사 → 계층. */
final class PackageLayout {

    static final String SPRING_BOOT_APPLICATION = "org.springframework.boot.autoconfigure.SpringBootApplication";

    /** 접미사 → 있어야 할 계층. 이름 끝만 본다 (예 OrderQueryService 는 Service). 프로젝트 접미사에 맞게 고친다. */
    static final Map<String, String> SUFFIX_LAYERS = ArchRules.FEATURE_FIRST ? featureFirstSuffixes() : layerFirstSuffixes();

    /** 기준 패키지 아래 직접 작성한 최상위 클래스 (생성 코드 · package-info 제외). 중첩 · 익명 클래스는 바깥 클래스 위치를 따른다. */
    static final DescribedPredicate<JavaClass> APP_CLASS = DescribedPredicate.describe(
            "기준 패키지 아래 클래스 (생성 코드 제외)",
            javaClass -> javaClass.isTopLevelClass()
                    && !javaClass.getSimpleName().equals("package-info")
                    && PackageLocation.of(javaClass.getPackageName())
                            .filter(location -> !location.isGenerated())
                            .isPresent());

    static final ArchCondition<JavaClass> RESIDE_IN_ALLOWED_TOP_LEVEL =
            new ArchCondition<>("feature · config · shared (component-web 이면 web · customer 도) 또는 루트의 메인 클래스에 있다") {
                @Override
                public void check(JavaClass javaClass, ConditionEvents events) {
                    PackageLocation location = location(javaClass);
                    if (location.isRoot()) {
                        if (!javaClass.isAnnotatedWith(SPRING_BOOT_APPLICATION)
                                && !javaClass.isMetaAnnotatedWith(SPRING_BOOT_APPLICATION)) {
                            events.add(SimpleConditionEvent.violated(
                                    javaClass, javaClass.getName() + " 는 기준 패키지 바로 아래에 있다. 여기에는 @SpringBootApplication 메인 클래스만 둔다"));
                        }
                        return;
                    }
                    if (location.customer().isPresent() && !location.isFeature() && !location.isWeb() && !location.isConfigOrShared()) {
                        events.add(SimpleConditionEvent.violated(
                                javaClass,
                                javaClass.getName() + " 는 customer/" + location.customer().get() + "/ 바로 아래가 feature · web · config · shared 가 아니다"));
                        return;
                    }
                    if (!location.isFeature() && !location.isConfigOrShared() && !location.isWeb() && location.customer().isEmpty()) {
                        events.add(SimpleConditionEvent.violated(
                                javaClass,
                                javaClass.getName() + " 의 최상위 패키지 '" + location.top() + "' 는 허용되지 않는다 ("
                                        + (ArchRules.COMPONENT_WEB ? "feature · web · config · shared · customer 만)" : "feature · config · shared 만)")));
                    }
                }
            };

    static final ArchCondition<JavaClass> HAVE_FEATURE_LAYER_PACKAGE =
            new ArchCondition<>("feature/<기능>/<계층> 또는 feature/<기능>/<하위기능>/<계층> 에 있다") {
                @Override
                public void check(JavaClass javaClass, ConditionEvents events) {
                    PackageLocation location = location(javaClass);
                    if (location.isFeature() && !location.isValidFeatureLayout()) {
                        events.add(SimpleConditionEvent.violated(
                                javaClass,
                                javaClass.getName() + " 는 feature/<기능>/<계층> · feature/<기능>/<하위기능>/<계층> 이 아니다. 계층은 "
                                        + String.join(" · ", PackageLocation.LAYERS.stream().sorted().toList())
                                        + " 중 하나이고 그 아래 패키지를 두지 않는다"));
                    }
                }
            };

    static final ArchCondition<JavaClass> HAVE_WEB_LAYER_PACKAGE =
            new ArchCondition<>("web/views/<화면 경로>/<계층> 또는 web/api/<묶음>/<계층> 에 있다") {
                @Override
                public void check(JavaClass javaClass, ConditionEvents events) {
                    PackageLocation location = location(javaClass);
                    if (location.isWeb() && !location.isValidWebLayout()) {
                        events.add(SimpleConditionEvent.violated(
                                javaClass,
                                javaClass.getName() + " 는 web/views/<화면 경로>/<계층> · web/api/<묶음>/<계층> 이 아니다. 계층은 "
                                        + String.join(" · ", PackageLocation.WEB_LAYERS.stream().sorted().toList())
                                        + " 중 하나이고 그 아래 패키지를 두지 않는다"));
                    }
                }
            };

    static final ArchCondition<JavaClass> NOT_BE_ENTRY_IN_FEATURE =
            new ArchCondition<>("기능 안 controller · websocket 계층에 있지 않다") {
                @Override
                public void check(JavaClass javaClass, ConditionEvents events) {
                    PackageLocation location = location(javaClass);
                    Optional<String> layer = location.isValidFeatureLayout() ? location.layer() : Optional.empty();
                    if (layer.filter(PackageLocation.ENTRY_LAYERS::contains).isPresent()) {
                        events.add(SimpleConditionEvent.violated(
                                javaClass,
                                javaClass.getName() + " 는 기능 안 " + layer.get() + " 계층에 있다. 진입점은 web/views/<화면>/" + layer.get()
                                        + " (화면이 부르지 않는 API 는 web/api/<묶음>/" + layer.get() + ") 로 옮긴다"));
                    }
                }
            };

    static final ArchCondition<JavaClass> RESIDE_IN_LAYER_OF_SUFFIX = new ArchCondition<>("접미사에 맞는 계층 패키지에 있다") {
        @Override
        public void check(JavaClass javaClass, ConditionEvents events) {
            PackageLocation location = location(javaClass);
            // 최상위 config · shared 는 예외. 기능 모양이 틀린 클래스는 기능/계층 규칙이 잡는다.
            if (location.isConfigOrShared() || (location.isFeature() && !location.isValidFeatureLayout())
                    || (location.isWeb() && !location.isValidWebLayout())) {
                return;
            }
            Optional<Map.Entry<String, String>> expected = SUFFIX_LAYERS.entrySet().stream()
                    .filter(entry -> javaClass.getSimpleName().endsWith(entry.getKey()))
                    .findFirst();
            if (expected.isEmpty()) {
                return;
            }
            String expectedLayer = expected.get().getValue();
            if (!location.layer().map(expectedLayer::equals).orElse(false)) {
                String where = !ArchRules.FEATURE_FIRST ? expectedLayer + "/"
                        : ArchRules.COMPONENT_WEB && PackageLocation.ENTRY_LAYERS.contains(expectedLayer) ? "web/views/<화면>/" + expectedLayer
                        : location.isWeb() && PackageLocation.WEB_LAYERS.contains(expectedLayer) ? "web/…/" + expectedLayer
                        : "feature/<기능>/" + expectedLayer;
                events.add(SimpleConditionEvent.violated(
                        javaClass, javaClass.getName() + " 는 이름이 *" + expected.get().getKey() + " 라 " + where + " 에 있어야 한다"));
            }
        }
    };

    private PackageLayout() {}

    static PackageLocation location(JavaClass javaClass) {
        return PackageLocation.of(javaClass.getPackageName()).orElseThrow();
    }

    static Map<String, String> featureFirstSuffixes() {
        Map<String, String> layers = new LinkedHashMap<>();
        layers.put("Controller", "controller");
        layers.put("Service", "service");
        layers.put("Query", "repository");
        layers.put("Store", "repository");
        layers.put("Repository", "repository");
        layers.put("Mapper", "mapper");
        layers.put("Client", "client");
        layers.put("Request", "dto");
        layers.put("Response", "dto");
        layers.put("Configuration", "config");
        layers.put("Properties", "config");
        layers.put("ErrorCode", "exception");
        layers.put("Exception", "exception");
        return Collections.unmodifiableMap(layers);
    }

    /** 계층 먼저 구조 (stack-spring 기본 표): 최상위 패키지 이름. */
    static Map<String, String> layerFirstSuffixes() {
        Map<String, String> layers = new LinkedHashMap<>();
        layers.put("Api", "webapi");
        layers.put("Form", "webapi");
        layers.put("Service", "service");
        layers.put("Query", "query");
        layers.put("Repository", "repository");
        layers.put("Mapper", "mapper");
        layers.put("Dto", "model");
        layers.put("Config", "config");
        return Collections.unmodifiableMap(layers);
    }
}
