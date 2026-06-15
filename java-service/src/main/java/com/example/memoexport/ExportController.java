package com.example.memoexport;

import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/export")
public class ExportController {

    private final JdbcTemplate jdbc;

    public ExportController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/memos")
    public void exportMemos(@RequestParam Long userId,
                            HttpServletResponse response) throws IOException {

        // DB에서 해당 유저의 메모 조회
        List<Map<String, Object>> memos = jdbc.queryForList(
            "SELECT title, content, tag, created_at, edited_at " +
            "FROM memos WHERE user_id = ? AND deleted_at IS NULL " +
            "ORDER BY created_at DESC",
            userId
        );

        // 엑셀 워크북 생성
        try (Workbook wb = new XSSFWorkbook()) {
            Sheet sheet = wb.createSheet("내 메모");

            // 컬럼 너비 설정
            sheet.setColumnWidth(0, 8000);   // 제목
            sheet.setColumnWidth(1, 20000);  // 내용
            sheet.setColumnWidth(2, 4000);   // 태그
            sheet.setColumnWidth(3, 6000);   // 작성일
            sheet.setColumnWidth(4, 6000);   // 수정일

            // 헤더 스타일
            CellStyle headerStyle = wb.createCellStyle();
            Font headerFont = wb.createFont();
            headerFont.setBold(true);
            headerFont.setFontHeightInPoints((short) 11);
            headerStyle.setFont(headerFont);
            headerStyle.setFillForegroundColor(IndexedColors.LAVENDER.getIndex());
            headerStyle.setFillPattern(FillPatternType.SOLID_FOREGROUND);
            headerStyle.setBorderBottom(BorderStyle.THIN);
            headerStyle.setAlignment(HorizontalAlignment.CENTER);

            // 헤더 행
            Row header = sheet.createRow(0);
            String[] cols = {"제목", "내용", "태그", "작성일", "수정일"};
            for (int i = 0; i < cols.length; i++) {
                Cell cell = header.createCell(i);
                cell.setCellValue(cols[i]);
                cell.setCellStyle(headerStyle);
            }

            // 데이터 스타일
            CellStyle dataStyle = wb.createCellStyle();
            dataStyle.setWrapText(true);
            dataStyle.setVerticalAlignment(VerticalAlignment.TOP);

            // 데이터 행
            for (int i = 0; i < memos.size(); i++) {
                Map<String, Object> memo = memos.get(i);
                Row row = sheet.createRow(i + 1);
                row.setHeightInPoints(40);

                createCell(row, 0, str(memo.get("title")), dataStyle);
                createCell(row, 1, str(memo.get("content")), dataStyle);
                createCell(row, 2, str(memo.get("tag")), dataStyle);
                createCell(row, 3, str(memo.get("created_at")), dataStyle);
                createCell(row, 4, str(memo.get("edited_at")), dataStyle);
            }

            // 응답 헤더
            response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            response.setHeader("Content-Disposition", "attachment; filename*=UTF-8''memo_export.xlsx");

            wb.write(response.getOutputStream());
        }
    }

    private void createCell(Row row, int col, String value, CellStyle style) {
        Cell cell = row.createCell(col);
        cell.setCellValue(value != null ? value : "");
        cell.setCellStyle(style);
    }

    private String str(Object obj) {
        return obj == null ? "" : obj.toString();
    }
}
