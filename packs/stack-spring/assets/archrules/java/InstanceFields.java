package __BASE_PACKAGE__.archrules;

import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaField;
import com.tngtech.archunit.core.domain.JavaModifier;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;

/**
 * static 이 아닌 필드는 private 이다.
 *
 * 제외: 생성 코드, MapStruct 생성 구현(*MapperImpl · @Generated), record (컴포넌트 필드는 이미 private), synthetic 필드. final 여부는 보지 않는다.
 */
final class InstanceFields {

    static final DescribedPredicate<JavaClass> CHECKED_CLASS = DescribedPredicate.describe(
            "기준 패키지 아래 직접 작성한 클래스 (생성 코드 · 생성 구현 · record 제외)",
            javaClass -> PackageLocation.of(javaClass.getPackageName())
                            .filter(location -> !location.isGenerated())
                            .isPresent()
                    && !javaClass.isRecord()
                    && !javaClass.getSimpleName().endsWith("MapperImpl")
                    && javaClass.getAnnotations().stream()
                            .noneMatch(annotation -> annotation.getRawType().getSimpleName().equals("Generated")));

    static final ArchCondition<JavaClass> HAVE_NON_PRIVATE_INSTANCE_FIELD = new ArchCondition<>("static 이 아닌 필드가 private 이 아니다") {
        @Override
        public void check(JavaClass javaClass, ConditionEvents events) {
            for (JavaField field : javaClass.getFields()) {
                if (field.getModifiers().contains(JavaModifier.STATIC)
                        || field.getModifiers().contains(JavaModifier.SYNTHETIC)
                        || field.getModifiers().contains(JavaModifier.PRIVATE)) {
                    continue;
                }
                events.add(SimpleConditionEvent.satisfied(field, field.getFullName() + " 는 private 이 아닌 인스턴스 필드다"));
            }
        }
    };

    private InstanceFields() {}
}
