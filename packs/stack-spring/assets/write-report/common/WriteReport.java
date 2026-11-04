package __BASE_PACKAGE__.writereport;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * 쓰기 보고서: 시험이 DB 에 무엇을 썼는지 기대값(승인본)으로 고정한다.
 *
 * <pre>
 * WriteReport.assertMatches("savesDailySales", "shop.daily_sales", "shop.refunds");
 * </pre>
 *
 * - 시험 안에서 부르면 그때까지 그 시험이 쓴 것으로 비교한다 (@AfterEach 에서 부르면 방금 끝난 시험).
 * - 테이블을 고르면 그 테이블만 고정한다. 고른 테이블에 쓴 행이 없으면 「테이블: []」 로 고정한다. 인자가 없으면 쓴 테이블 전부.
 * - 승인본 갱신은 -DwriteReport.approve=true 일 때만. 다르면 AssertionError (승인본 · 받은 값 경로와 차이 앞 40줄).
 * 형식: packs/core/assets/write-report/FORMAT.md (kedovi 킷). 설정: src/test/resources/write-report.properties.
 */
public final class WriteReport {

    private WriteReport() {
    }

    public static void assertMatches(String name, String... tables) {
        WriteReportRecorder.Window w = WriteReportRecorder.window();
        if (w == null) {
            throw new AssertionError("쓰기 보고서: 기록 중인 시험이 없다. Spring 시험(@SpringBootTest · @JooqTest · @JdbcTest 등) 안에서 부르고, "
                    + "src/test/resources/META-INF/spring.factories 에 WriteReportListener 가 등록됐는지 본다");
        }
        WriteReportRecorder.loadCatalog(w);
        WriteReportConfig cfg = WriteReportConfig.get();
        String received = WriteReportNormalizer.approval(WriteReportRecorder.writes(w), tables, WriteReportRecorder.CATALOG, cfg);
        String file = WriteReportRecorder.safe(name) + ".yaml";
        Path approvedFile = cfg.approved.resolve(WriteReportRecorder.safe(w.group)).resolve(file);
        Path receivedFile = cfg.output.resolve("received").resolve(WriteReportRecorder.safe(w.group)).resolve(file);
        try {
            if (WriteReportConfig.approveMode()) {
                Files.createDirectories(approvedFile.getParent());
                Files.writeString(approvedFile, received, StandardCharsets.UTF_8);
                Files.deleteIfExists(receivedFile);
                return;
            }
            String approved = Files.exists(approvedFile) ? Files.readString(approvedFile, StandardCharsets.UTF_8) : null;
            if (approved != null && approved.replace("\r\n", "\n").equals(received)) {
                Files.deleteIfExists(receivedFile);
                return;
            }
            Files.createDirectories(receivedFile.getParent());
            Files.writeString(receivedFile, received, StandardCharsets.UTF_8);
            if (approved == null) {
                throw new AssertionError("쓰기 보고서 승인본이 없다: " + approvedFile + "\n받은 값: " + receivedFile
                        + "\n내용을 확인하고 맞으면 -DwriteReport.approve=true 로 한 번 돌려 승인본을 만든다.\n" + head(received, 40));
            }
            throw new AssertionError("쓰기 보고서가 승인본과 다르다 (" + w.id + ", " + name + ")\n승인본: " + approvedFile
                    + "\n받은 값: " + receivedFile + "\n의도한 변경이면 -DwriteReport.approve=true 로 승인본을 갱신한다.\n"
                    + diff(approved.replace("\r\n", "\n"), received, 40));
        } catch (IOException e) {
            throw new AssertionError("쓰기 보고서 파일을 다루지 못했다: " + e.getMessage(), e);
        }
    }

    /** 고정하지 않고 지금 시험의 쓰기 보고서(승인본 모양)를 문자열로 본다. 디버깅용. */
    public static String current(String... tables) {
        WriteReportRecorder.Window w = WriteReportRecorder.window();
        if (w == null) {
            return "";
        }
        WriteReportRecorder.loadCatalog(w);
        return WriteReportNormalizer.approval(WriteReportRecorder.writes(w), tables, WriteReportRecorder.CATALOG, WriteReportConfig.get());
    }

    private static String head(String s, int lines) {
        List<String> l = Arrays.asList(s.split("\n", -1));
        return String.join("\n", l.subList(0, Math.min(lines, l.size())));
    }

    /** 줄 단위 차이 (- 승인본, + 받은 값) 앞 max 줄. */
    static String diff(String a, String b, int max) {
        String[] x = a.split("\n", -1);
        String[] y = b.split("\n", -1);
        List<String> out = new ArrayList<>();
        if ((long) x.length * y.length > 4_000_000L) {
            int i = 0;
            while (i < x.length && i < y.length && x[i].equals(y[i])) {
                i++;
            }
            out.add("@@ " + (i + 1) + "번째 줄부터 다르다");
            for (int k = i; k < x.length && out.size() < max; k++) {
                out.add("- " + x[k]);
            }
            for (int k = i; k < y.length && out.size() < max; k++) {
                out.add("+ " + y[k]);
            }
            return String.join("\n", out);
        }
        int[][] lcs = new int[x.length + 1][y.length + 1];
        for (int i = x.length - 1; i >= 0; i--) {
            for (int j = y.length - 1; j >= 0; j--) {
                lcs[i][j] = x[i].equals(y[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
            }
        }
        int i = 0;
        int j = 0;
        while ((i < x.length || j < y.length) && out.size() < max) {
            if (i < x.length && j < y.length && x[i].equals(y[j])) {
                i++;
                j++;
            } else if (i < x.length && (j == y.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
                out.add("- " + x[i++]);
            } else {
                out.add("+ " + y[j++]);
            }
        }
        String hint = firstChange(out);
        return (hint == null ? "" : hint + "\n") + String.join("\n", out);
    }

    /** 처음 바뀐 줄 쌍(- 다음 +)에서 다른 부분만 짧게: 「첫 차이: …qty: 0} → …qty: null}」. */
    private static String firstChange(List<String> lines) {
        for (int k = 0; k + 1 < lines.size(); k++) {
            String a = lines.get(k);
            String b = lines.get(k + 1);
            if (a.startsWith("- ") && b.startsWith("+ ")) {
                a = a.substring(2);
                b = b.substring(2);
                int p = 0;
                while (p < a.length() && p < b.length() && a.charAt(p) == b.charAt(p)) {
                    p++;
                }
                int sa = a.length();
                int sb = b.length();
                while (sa > p && sb > p && a.charAt(sa - 1) == b.charAt(sb - 1)) {
                    sa--;
                    sb--;
                }
                int from = Math.max(0, p - 30);
                String pre = from > 0 ? "…" : "";
                return "첫 차이: " + pre + a.substring(from, Math.min(a.length(), sa + 10)) + "  →  " + pre + b.substring(from, Math.min(b.length(), sb + 10));
            }
        }
        return null;
    }
}
