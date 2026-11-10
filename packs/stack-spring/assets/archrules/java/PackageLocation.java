package __BASE_PACKAGE__.archrules;

import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * 기준 패키지 아래 위치. rest 는 기준 패키지 다음 단계들이다.
 *
 * 예: 기준 com.example.app, 클래스 패키지 com.example.app.feature.auth.passkey.service → rest [feature, auth,
 * passkey, service]. component-web 의 고객사 코드(customer.<고객>.feature.…)는 body() 가 고객사 접두를 뺀 나머지다.
 */
record PackageLocation(List<String> rest) {

    static final String FEATURE = "feature";
    static final String CONFIG = "config";
    static final String SHARED = "shared";
    static final String WEB = "web";
    static final String CUSTOMER = "customer";

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

    /** component-web: web 아래 계층 (web/views/<화면 경로>/<계층> · web/api/<묶음>/<계층>). */
    static final Set<String> WEB_LAYERS = Set.of("controller", "dto", "mapper", "websocket");

    /** component-web: web 바로 아래 구분. */
    static final Set<String> WEB_KINDS = Set.of("views", "api");

    /** component-web: 기능 안에 두지 않는 진입점 계층 (web 으로 간다). */
    static final Set<String> ENTRY_LAYERS = Set.of("controller", "websocket");

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

    /** component-web 의 customer.<고객>. … 이면 고객 이름. */
    Optional<String> customer() {
        return ArchRules.COMPONENT_WEB && top().equals(CUSTOMER) && rest.size() >= 2 ? Optional.of(rest.get(1)) : Optional.empty();
    }

    /** 고객사 접두(customer.<고객>)를 뺀 위치. 고객사 코드가 아니면 rest 그대로. */
    List<String> body() {
        return customer().isPresent() ? rest.subList(2, rest.size()) : rest;
    }

    /** body 의 첫 단계 (feature · web · config · shared …). */
    String bodyTop() {
        List<String> body = body();
        return body.isEmpty() ? "" : body.get(0);
    }

    /** 고객사 접두 (customer.<고객>.) 또는 빈 문자열. 단위 이름 앞에 붙인다. */
    String prefix() {
        return customer().map(name -> CUSTOMER + "." + name + ".").orElse("");
    }

    boolean isFeature() {
        return bodyTop().equals(FEATURE);
    }

    boolean isWeb() {
        return ArchRules.COMPONENT_WEB && bodyTop().equals(WEB);
    }

    boolean isGenerated() {
        return ArchRules.GENERATED_TOP_PACKAGES.contains(top());
    }

    /** 최상위 config · shared (고객사 안 포함): 전역 설정 · 공통이라 접미사 위치 규칙에서 빠진다 (feature-first). */
    boolean isConfigOrShared() {
        return ArchRules.FEATURE_FIRST && (bodyTop().equals(CONFIG) || bodyTop().equals(SHARED));
    }

    /** feature/<기능>/<계층> 또는 feature/<기능>/<하위기능>/<계층> 이고 계층이 끝이다. */
    boolean isValidFeatureLayout() {
        if (!isFeature()) {
            return false;
        }
        List<String> body = body();
        if (body.size() == 3) {
            return LAYERS.contains(body.get(2));
        }
        // 하위 기능 이름이 계층 이름이면 계층 아래에 패키지를 둔 것이다.
        return body.size() == 4 && !LAYERS.contains(body.get(2)) && LAYERS.contains(body.get(3));
    }

    /** web/views|api/<이름 한 단계 이상>/<web 계층> 이고 계층이 끝이다. 화면 경로 중간에 계층 이름을 쓰지 않는다. */
    boolean isValidWebLayout() {
        if (!isWeb()) {
            return false;
        }
        List<String> body = body();
        if (body.size() < 4 || !WEB_KINDS.contains(body.get(1)) || !WEB_LAYERS.contains(body.get(body.size() - 1))) {
            return false;
        }
        return body.subList(2, body.size() - 1).stream().noneMatch(WEB_LAYERS::contains);
    }

    /** 계층 이름. feature-first 는 기능 · web 안 마지막 단계, 계층 먼저 구조는 최상위 단계. */
    Optional<String> layer() {
        if (ArchRules.FEATURE_FIRST) {
            return isValidFeatureLayout() || isValidWebLayout() ? Optional.of(rest.get(rest.size() - 1)) : Optional.empty();
        }
        return rest.isEmpty() ? Optional.empty() : Optional.of(top());
    }

    /** 경계 단위: 하위 기능까지 포함한 기능 경로 (예 feature.auth.passkey). 하위 기능끼리도 다른 단위다. */
    Optional<String> featureUnit() {
        List<String> body = body();
        return isValidFeatureLayout() ? Optional.of(prefix() + String.join(".", body.subList(0, body.size() - 1))) : Optional.empty();
    }

    /** web 단위: 화면 하나 · API 묶음 하나 (예 web.views.order.list). */
    Optional<String> webUnit() {
        List<String> body = body();
        return isValidWebLayout() ? Optional.of(prefix() + String.join(".", body.subList(0, body.size() - 1))) : Optional.empty();
    }

    /** 최상위 기능 이름. 기능 패키지가 아니면 빈 값. */
    Optional<String> featureName() {
        List<String> body = body();
        return isFeature() && body.size() >= 2 ? Optional.of(body.get(1)) : Optional.empty();
    }
}
