package __BASE_PACKAGE__.archrules;

import com.tngtech.archunit.core.domain.Dependency;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;
import java.util.Optional;

/**
 * 기능 경계: 다른 기능은 공개 계층만 (하위 기능 → 상위 기능은 전부), config · shared 는 feature 를 모른다, 지정한 기능은 다른 기능을 모른다.
 * component-web: web 은 기능의 공개 계층만, feature 는 web 을 모른다, web 단위(화면 · API 묶음)끼리 모른다, 공통은 customer 를 모른다.
 */
final class FeatureBoundaries {

    static final ArchCondition<JavaClass> ONLY_USE_PUBLIC_LAYERS_OF_OTHER_FEATURES =
            new ArchCondition<>("다른 기능은 service · model · dto · exception 계층만 참조한다 (하위 기능 → 상위 기능은 전부)") {
                @Override
                public void check(JavaClass javaClass, ConditionEvents events) {
                    Optional<PackageLocation> own = PackageLocation.of(javaClass.getPackageName());
                    Optional<String> ownUnit = own.flatMap(PackageLocation::featureUnit).or(() -> own.flatMap(PackageLocation::webUnit));
                    if (ownUnit.isEmpty()) {
                        return;
                    }
                    for (Dependency dependency : javaClass.getDirectDependenciesFromSelf()) {
                        Optional<PackageLocation> target = PackageLocation.of(dependency.getTargetClass().getPackageName());
                        Optional<String> targetUnit = target.flatMap(PackageLocation::featureUnit);
                        if (targetUnit.isEmpty() || targetUnit.equals(ownUnit) || isParentUnit(targetUnit.get(), ownUnit.get())) {
                            continue;
                        }
                        String targetLayer = target.get().layer().orElseThrow();
                        if (!PackageLocation.PUBLIC_LAYERS.contains(targetLayer)) {
                            events.add(SimpleConditionEvent.violated(
                                    dependency,
                                    dependency.getDescription() + ": 다른 기능의 '" + targetLayer
                                            + "' 계층은 그 기능 내부다 (공개: service · model · dto · exception)"));
                        }
                    }
                }
            };

    static final ArchCondition<JavaClass> NOT_DEPEND_ON_FEATURE = new ArchCondition<>("feature (component-web 이면 web 도) 를 참조하지 않는다") {
        @Override
        public void check(JavaClass javaClass, ConditionEvents events) {
            for (Dependency dependency : javaClass.getDirectDependenciesFromSelf()) {
                Optional<PackageLocation> target = PackageLocation.of(dependency.getTargetClass().getPackageName());
                if (target.filter(PackageLocation::isFeature).isPresent()) {
                    events.add(SimpleConditionEvent.violated(
                            dependency, dependency.getDescription() + ": config · shared 는 feature 를 참조하지 않는다"));
                } else if (target.filter(PackageLocation::isWeb).isPresent()) {
                    events.add(SimpleConditionEvent.violated(
                            dependency, dependency.getDescription() + ": config · shared 는 web 을 참조하지 않는다"));
                }
            }
        }
    };

    /** component-web: feature 는 web 을 모른다. */
    static final ArchCondition<JavaClass> NOT_DEPEND_ON_WEB = new ArchCondition<>("web 을 참조하지 않는다") {
        @Override
        public void check(JavaClass javaClass, ConditionEvents events) {
            for (Dependency dependency : javaClass.getDirectDependenciesFromSelf()) {
                if (PackageLocation.of(dependency.getTargetClass().getPackageName()).filter(PackageLocation::isWeb).isPresent()) {
                    events.add(SimpleConditionEvent.violated(
                            dependency, dependency.getDescription() + ": feature 는 web 을 참조하지 않는다 (방향은 web → feature → shared)"));
                }
            }
        }
    };

    /** component-web: web 단위(화면 하나 · API 묶음 하나)는 다른 web 단위를 참조하지 않는다. */
    static final ArchCondition<JavaClass> NOT_DEPEND_ON_OTHER_WEB_UNITS = new ArchCondition<>("다른 화면 · API 묶음을 참조하지 않는다") {
        @Override
        public void check(JavaClass javaClass, ConditionEvents events) {
            Optional<String> ownUnit = PackageLocation.of(javaClass.getPackageName()).flatMap(PackageLocation::webUnit);
            if (ownUnit.isEmpty()) {
                return;
            }
            for (Dependency dependency : javaClass.getDirectDependenciesFromSelf()) {
                Optional<String> targetUnit = PackageLocation.of(dependency.getTargetClass().getPackageName()).flatMap(PackageLocation::webUnit);
                if (targetUnit.isPresent() && !targetUnit.equals(ownUnit)) {
                    events.add(SimpleConditionEvent.violated(
                            dependency, dependency.getDescription() + ": " + ownUnit.get() + " 는 " + targetUnit.get()
                                    + " 를 참조하지 않는다. 함께 쓰는 것은 feature 나 shared 로 내린다"));
                }
            }
        }
    };

    /** component-web: 공통 코드는 customer 를 모르고, 고객사끼리도 모른다. */
    static final ArchCondition<JavaClass> NOT_DEPEND_ON_OTHER_CUSTOMER = new ArchCondition<>("다른 고객사 코드를 참조하지 않는다") {
        @Override
        public void check(JavaClass javaClass, ConditionEvents events) {
            Optional<String> own = PackageLocation.of(javaClass.getPackageName()).flatMap(PackageLocation::customer);
            for (Dependency dependency : javaClass.getDirectDependenciesFromSelf()) {
                Optional<String> target = PackageLocation.of(dependency.getTargetClass().getPackageName()).flatMap(PackageLocation::customer);
                if (target.isPresent() && !target.equals(own)) {
                    events.add(SimpleConditionEvent.violated(
                            dependency, dependency.getDescription() + (own.isEmpty()
                                    ? ": 공통 코드는 customer/" + target.get() + " 를 참조하지 않는다. 공통이 인터페이스를 정하고 고객사가 구현한다"
                                    : ": customer/" + own.get() + " 는 customer/" + target.get() + " 를 참조하지 않는다")));
                }
            }
        }
    };

    private FeatureBoundaries() {}

    static ArchCondition<JavaClass> notDependOnOtherFeatures(String featureName) {
        return new ArchCondition<>("다른 기능을 참조하지 않는다") {
            @Override
            public void check(JavaClass javaClass, ConditionEvents events) {
                for (Dependency dependency : javaClass.getDirectDependenciesFromSelf()) {
                    Optional<String> targetFeature = PackageLocation.of(dependency.getTargetClass().getPackageName())
                            .flatMap(PackageLocation::featureName);
                    if (targetFeature.isPresent() && !targetFeature.get().equals(featureName)) {
                        events.add(SimpleConditionEvent.violated(
                                dependency,
                                dependency.getDescription() + ": feature/" + featureName + " 는 다른 기능('" + targetFeature.get()
                                        + "')을 참조하지 않는다"));
                    }
                }
            }
        };
    }

    /** 하위 기능은 자기 상위 기능의 모든 계층을 참조한다 (기능 전체 설정 · 예외를 하위 기능이 쓴다). 반대와 하위 기능끼리는 공개 계층만. */
    static boolean isParentUnit(String candidateParent, String unit) {
        return unit.startsWith(candidateParent + ".");
    }
}
