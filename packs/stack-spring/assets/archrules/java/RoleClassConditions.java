package __BASE_PACKAGE__.archrules;

import com.tngtech.archunit.core.domain.JavaAccess;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaField;
import com.tngtech.archunit.core.domain.JavaMethod;
import com.tngtech.archunit.core.domain.JavaModifier;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;

/**
 * 역할 클래스에는 역할 메서드 · 주입 필드 · Logger 만 둔다.
 *
 * 람다가 만드는 private synthetic 메서드는 ArchUnit 이 가져오지 않고, 람다 안의 호출은 람다를 둔 메서드의 호출로 잡힌다.
 */
final class RoleClassConditions {

    /** 접근 제한자와 관계없이 도우미가 아닌 메서드: 프레임워크가 부르는 진입점 · 빈 정의 · 수명 주기. */
    static final List<String> ENTRY_POINT_ANNOTATIONS = List.of(
            "org.springframework.context.annotation.Bean",
            RoleClasses.SCHEDULED,
            RoleClasses.SCHEDULES,
            RoleClasses.RABBIT_LISTENER,
            RoleClasses.RABBIT_LISTENERS,
            RoleClasses.KAFKA_LISTENER,
            "org.springframework.amqp.rabbit.annotation.RabbitHandler",
            "org.springframework.context.event.EventListener",
            "org.springframework.transaction.event.TransactionalEventListener",
            "org.springframework.web.bind.annotation.ExceptionHandler",
            "org.springframework.web.bind.annotation.RequestMapping",
            "org.springframework.messaging.handler.annotation.MessageMapping",
            "jakarta.annotation.PostConstruct",
            "jakarta.annotation.PreDestroy");

    static final Set<String> LOGGER_TYPES =
            Set.of("org.slf4j.Logger", "java.lang.System$Logger", "java.util.logging.Logger", "org.apache.logging.log4j.Logger");

    /** 도우미 메서드 0개: 접근 제한자와 관계없이 본다. private 을 빼고 public 으로 바꿔도 자기만 부르면 도우미다. */
    static final ArchCondition<JavaClass> HAVE_NO_HELPER_METHODS = new ArchCondition<>("도우미 메서드를 두지 않는다") {
        @Override
        public void check(JavaClass javaClass, ConditionEvents events) {
            for (JavaMethod method : javaClass.getMethods()) {
                if (isGenerated(method.getModifiers()) || isEntryPoint(method) || overridesSupertype(method)) {
                    continue;
                }
                if (!method.getModifiers().contains(JavaModifier.PUBLIC)) {
                    events.add(SimpleConditionEvent.violated(
                            method, visibility(method) + " 도우미 메서드 " + method.getFullName() + " 가 역할 클래스에 있다"));
                } else if (calledOnlyBySelf(method)) {
                    events.add(SimpleConditionEvent.violated(
                            method, "자기 클래스만 부르는 public 도우미 메서드 " + method.getFullName() + " 가 역할 클래스에 있다"));
                }
            }
        }
    };

    static final ArchCondition<JavaClass> HAVE_ONLY_LOGGER_STATIC_FIELDS = new ArchCondition<>("static 필드는 Logger 만 둔다") {
        @Override
        public void check(JavaClass javaClass, ConditionEvents events) {
            for (JavaField field : javaClass.getFields()) {
                if (field.getModifiers().contains(JavaModifier.STATIC)
                        && !isGenerated(field.getModifiers())
                        && !LOGGER_TYPES.contains(field.getRawType().getName())) {
                    events.add(SimpleConditionEvent.violated(
                            field, "static 필드 " + field.getFullName() + " 가 역할 클래스에 있다 (Logger 만 허용. enum · *Properties · model 상수 클래스로)"));
                }
            }
        }
    };

    static final ArchCondition<JavaClass> NOT_BE_NESTED_IN_ROLE_CLASS = new ArchCondition<>("역할 클래스 안의 중첩 타입이 아니다") {
        @Override
        public void check(JavaClass javaClass, ConditionEvents events) {
            if (javaClass.isMemberClass()
                    && javaClass.getEnclosingClass().map(RoleClasses::isRoleClass).orElse(false)) {
                events.add(SimpleConditionEvent.violated(
                        javaClass, "중첩 타입 " + javaClass.getName() + " 가 역할 클래스 안에 있다 (dto · model 등 계층 패키지의 클래스로)"));
            }
        }
    };

    private RoleClassConditions() {}

    static boolean isGenerated(Set<JavaModifier> modifiers) {
        return modifiers.contains(JavaModifier.SYNTHETIC) || modifiers.contains(JavaModifier.BRIDGE);
    }

    static boolean isEntryPoint(JavaMethod method) {
        return ENTRY_POINT_ANNOTATIONS.stream()
                .anyMatch(annotation -> method.isAnnotatedWith(annotation) || method.isMetaAnnotatedWith(annotation));
    }

    /** 상위 클래스 · 인터페이스에 같은 이름 · 같은 인자 수 메서드가 있으면 구현으로 본다 (제네릭은 지워진 인자 타입이 달라 타입까지 맞추지 않는다). */
    static boolean overridesSupertype(JavaMethod method) {
        JavaClass owner = method.getOwner();
        int parameterCount = method.getRawParameterTypes().size();
        return Stream.concat(owner.getAllRawSuperclasses().stream(), owner.getAllRawInterfaces().stream())
                .flatMap(supertype -> supertype.getMethods().stream())
                .anyMatch(candidate -> candidate.getName().equals(method.getName())
                        && candidate.getRawParameterTypes().size() == parameterCount
                        && !candidate.getModifiers().contains(JavaModifier.PRIVATE));
    }

    /** 가져온 클래스 안에서 호출(메서드 참조 포함)이 있고 모두 이 클래스(중첩 · 익명 포함)에서 온다. 테스트 클래스는 호출자에 들지 않는다. */
    static boolean calledOnlyBySelf(JavaMethod method) {
        Set<? extends JavaAccess<?>> accesses = method.getAccessesToSelf();
        String ownerName = method.getOwner().getName();
        return !accesses.isEmpty()
                && accesses.stream()
                        .map(access -> access.getOriginOwner().getName())
                        .allMatch(origin -> origin.equals(ownerName) || origin.startsWith(ownerName + "$"));
    }

    static String visibility(JavaMethod method) {
        if (method.getModifiers().contains(JavaModifier.PRIVATE)) {
            return "private";
        }
        return method.getModifiers().contains(JavaModifier.PROTECTED) ? "protected" : "package-private";
    }
}
