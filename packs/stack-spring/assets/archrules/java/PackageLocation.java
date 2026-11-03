package __BASE_PACKAGE__.archrules;

import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * 기준 패키지 아래 위치. rest 는 기준 패키지 다음 단계들이다.
 *
 * 예: 기준 com.example.app, 클래스 패키지 com.example.app.feature.auth.passkey.service → rest [feature, auth,
 * passkey, service].
 */
record PackageLocation(List<String> rest) {

    static final String FEATURE = "feature";
    static final String CONFIG = "config";
    static final String SHARED = "shared";

    /** feature-first 의 계층 이름. 기능 안 패키지는 항상 이 이름 중 하나로 끝난다. */
    static final Set<String> LAYERS = Set.of(
            "controller",
            "websocket",
            "messaging",
            "job",
            "service",
            "model",
            "repository",
            "dto",
            "mapper",
            "client",
            "exception",
            "config");

    /** 다른 기능이 참조해도 되는 계층. */
    static final Set<String> PUBLIC_LAYERS = Set.of("service", "model", "dto", "exception");

    static Optional<PackageLocation> of(String packageName) {
        String base = ArchRules.BASE_PACKAGE;
        if (!packageName.equals(base) && !packageName.startsWith(base + ".")) {
            return Optional.empty();
        }
        String tail = packageName.substring(base.length());
        List<String> rest = tail.isEmpty() ? List.of() : List.copyOf(Arrays.asList(tail.substring(1).split("\\.")));
        return Optional.of(new PackageLocation(rest));
    }

    boolean isRoot() {
        return rest.isEmpty();
    }

    String top() {
        return rest.isEmpty() ? "" : rest.get(0);
    }

    boolean isFeature() {
        return top().equals(FEATURE);
    }

    boolean isGenerated() {
        return ArchRules.GENERATED_TOP_PACKAGES.contains(top());
    }

    /** 최상위 config · shared: 전역 설정 · 공통이라 접미사 위치 규칙에서 빠진다 (feature-first). */
    boolean isConfigOrShared() {
        return ArchRules.FEATURE_FIRST && (top().equals(CONFIG) || top().equals(SHARED));
    }

    /** feature/<기능>/<계층> 또는 feature/<기능>/<하위기능>/<계층> 이고 계층이 끝이다. */
    boolean isValidFeatureLayout() {
        if (!isFeature()) {
            return false;
        }
        if (rest.size() == 3) {
            return LAYERS.contains(rest.get(2));
        }
        // 하위 기능 이름이 계층 이름이면 계층 아래에 패키지를 둔 것이다.
        return rest.size() == 4 && !LAYERS.contains(rest.get(2)) && LAYERS.contains(rest.get(3));
    }

    /** 계층 이름. feature-first 는 기능 안 마지막 단계, 계층 먼저 구조는 최상위 단계. */
    Optional<String> layer() {
        if (ArchRules.FEATURE_FIRST) {
            return isValidFeatureLayout() ? Optional.of(rest.get(rest.size() - 1)) : Optional.empty();
        }
        return rest.isEmpty() ? Optional.empty() : Optional.of(top());
    }

    /** 경계 단위: 하위 기능까지 포함한 기능 경로 (예 feature.auth.passkey). 하위 기능끼리도 다른 단위다. */
    Optional<String> featureUnit() {
        return isValidFeatureLayout() ? Optional.of(String.join(".", rest.subList(0, rest.size() - 1))) : Optional.empty();
    }

    /** 최상위 기능 이름. 기능 패키지가 아니면 빈 값. */
    Optional<String> featureName() {
        return isFeature() && rest.size() >= 2 ? Optional.of(rest.get(1)) : Optional.empty();
    }
}
