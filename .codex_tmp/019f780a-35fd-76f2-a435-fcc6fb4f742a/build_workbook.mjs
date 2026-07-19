import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "C:/Users/Vuong Cong Thanh/Documents/00-MiniProjects/QuickInterviewTest/outputs/019f780a-35fd-76f2-a435-fcc6fb4f742a";
const outputPath = `${outputDir}/du_lieu_mau_gemini_google_sheets.xlsx`;

await fs.mkdir(outputDir, { recursive: true });

const workbook = Workbook.create();
const dataSheet = workbook.worksheets.add("Dữ liệu lỗi");
const guideSheet = workbook.worksheets.add("Hướng dẫn demo");

const headers = [
  "Người ứng",
  "Ngày chi",
  "Nội dung chi",
  "Số tiền (VND)",
  "Nhóm chi",
  "Ghi chú",
];

const dirtyRows = [
  ["nguyễn văn an", "1/3/2025", "Ăn trưa nhóm dự án", 850000, "Ăn uống", "Hóa đơn giấy"],
  ["NGUYỄN VĂN AN", "02-03-2025", "Taxi ra sân bay", 1250000, "DI CHUYỂN", "chưa có hóa đơn"],
  ["  Nguyễn   Văn An  ", "2025/03/03", "Mua văn phòng phẩm", 320000, "văn phòng", "  thanh toán tiền mặt  "],
  ["NguyÔn V¨n An", "04.03.2025", "Đặt cọc phòng họp", 2400000, "Thuê địa điểm", "CK"],
  ["trần thị bình", "5-3-25", "Nước uống workshop", 450000, "ăn uống", "đủ hóa đơn"],
  ["TRẦN THỊ BÌNH", "06/03/25", "Vé máy bay công tác", 1800000, "Di chuyển", "vé điện tử"],
  ["Trần  Thị Bình", "2025-03-07", "In tài liệu đào tạo", 980000, "VĂN PHÒNG", "HĐ VAT"],
  ["TrÇn ThÞ B×nh", "08 Mar 2025", "Thuê thiết bị trình chiếu", 1100000, "Thiết bị", "chờ duyệt"],
  ["lê hoàng minh", "9 tháng 3 2025", "Khách sạn 2 đêm", 2750000, "Lưu trú", "booking online"],
  ["LÊ HOÀNG MINH", "10/3/2025", "Tiếp khách", 610000, "Ăn Uống", "Hóa đơn VAT"],
  [" Lê Hoàng  Minh ", "11-03-25", "Mua ổ cứng dự phòng", 1050000, "thiết bị", "bảo hành 12 tháng"],
  ["Lª Hoµng Minh", "2025.03.12", "Phí vận chuyển", 275000, "Vận chuyển", "COD"],
  ["phạm gia hân", "13/03/2025", "Quà tặng khách hàng", 730000, "Đối ngoại", "không VAT"],
  ["PHẠM GIA HÂN", "14-3-2025", "Thuê xe đi tỉnh", 1480000, "di chuyển", "đã chuyển khoản"],
  ["Phạm  Gia Hân", "Mar 15, 2025", "Mua sim dữ liệu", 390000, "Viễn thông", "  hóa đơn điện tử"],
  ["Ph¹m Gia H©n", "16/03/25", "Tiệc tổng kết dự án", 2150000, "ĂN UỐNG", "chia sẻ hóa đơn"],
  ["đỗ quốc khánh", "2025/03/17", "Mua vật tư sự kiện", 560000, "Sự kiện", "phiếu bán lẻ"],
  ["ĐỖ QUỐC KHÁNH", "18.03.2025", "Thuê âm thanh", 1320000, "thiết bị", "đặt cọc 50%"],
  ["  Đỗ Quốc  Khánh", "19-03-2025", "Chi phí quảng cáo", 890000, "MARKETING", "Meta Ads"],
  ["§ç Quèc Kh¸nh", "20/3/25", "Thuê gian hàng triển lãm", 3200000, "Sự kiện", "hợp đồng số 03"],
];

dataSheet.getRange("A1:F21").values = [headers, ...dirtyRows];
dataSheet.showGridLines = false;
dataSheet.freezePanes.freezeRows(1);

dataSheet.getRange("A1:F1").format = {
  fill: "#1F4E78",
  font: { bold: true, color: "#FFFFFF", size: 11 },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
  borders: { preset: "outside", style: "medium", color: "#17365D" },
};
dataSheet.getRange("A1:F1").format.rowHeight = 30;

dataSheet.getRange("A2:F21").format = {
  font: { color: "#1F2937", size: 10 },
  verticalAlignment: "center",
  borders: {
    insideHorizontal: { style: "thin", color: "#DCE6F1" },
    bottom: { style: "thin", color: "#A6B8C9" },
  },
};

for (let row = 2; row <= 21; row += 1) {
  if (row % 2 === 1) {
    dataSheet.getRange(`A${row}:F${row}`).format.fill = "#F4F8FC";
  }
}

dataSheet.getRange("A2:B21").format.fill = "#FFF8E7";
dataSheet.getRange("B2:B21").format.numberFormat = "@";
dataSheet.getRange("D2:D21").format.numberFormat = "#,##0 \"VND\"";
dataSheet.getRange("D2:D21").format.horizontalAlignment = "right";
dataSheet.getRange("A2:C21").format.horizontalAlignment = "left";
dataSheet.getRange("E2:F21").format.horizontalAlignment = "left";
dataSheet.getRange("F2:F21").format.wrapText = true;
dataSheet.getRange("A1:A21").format.columnWidth = 24;
dataSheet.getRange("B1:B21").format.columnWidth = 18;
dataSheet.getRange("C1:C21").format.columnWidth = 30;
dataSheet.getRange("D1:D21").format.columnWidth = 18;
dataSheet.getRange("E1:E21").format.columnWidth = 18;
dataSheet.getRange("F1:F21").format.columnWidth = 28;
dataSheet.getRange("A2:F21").format.rowHeight = 23;

const dirtyTable = dataSheet.tables.add("A1:F21", true, "DuLieuLoiTable");
dirtyTable.style = "TableStyleMedium2";
dirtyTable.showFilterButton = true;

guideSheet.showGridLines = false;
guideSheet.getRange("A1:F1").merge();
guideSheet.getRange("A1").values = [["HƯỚNG DẪN DEMO GEMINI TRONG GOOGLE SHEETS"]];
guideSheet.getRange("A1:F1").format = {
  fill: "#1F4E78",
  font: { bold: true, color: "#FFFFFF", size: 16 },
  horizontalAlignment: "center",
  verticalAlignment: "center",
};
guideSheet.getRange("A1:F1").format.rowHeight = 38;

guideSheet.getRange("A3:F3").merge();
guideSheet.getRange("A3").values = [["1. Chuẩn hóa tên và ngày tháng"]];
guideSheet.getRange("A3:F3").format = {
  fill: "#D9EAF7",
  font: { bold: true, color: "#17365D", size: 12 },
  verticalAlignment: "center",
};
guideSheet.getRange("A3:F3").format.rowHeight = 26;

guideSheet.getRange("A4:F6").merge();
guideSheet.getRange("A4").values = [[
  "Bôi đen vùng A2:B21 trong tab ‘Dữ liệu lỗi’, mở Gemini và nhập:\n“Hãy cho tôi công thức để viết hoa chữ cái đầu tiên của tất cả các tên trong cột A, sửa các tên bị lỗi phông chữ/encoding, xóa khoảng trắng thừa, và chuẩn hóa ngày tháng ở cột B về định dạng dd/mm/yyyy.”",
]];
guideSheet.getRange("A4:F6").format = {
  fill: "#F7FBFF",
  font: { color: "#1F2937", size: 11 },
  wrapText: true,
  verticalAlignment: "center",
  borders: { preset: "outside", style: "thin", color: "#9FBAD0" },
};
guideSheet.getRange("A4:F6").format.rowHeight = 31;

guideSheet.getRange("A8:F8").merge();
guideSheet.getRange("A8").values = [["2. Tổng hợp và lọc chi tiêu"]];
guideSheet.getRange("A8:F8").format = {
  fill: "#D9EAF7",
  font: { bold: true, color: "#17365D", size: 12 },
  verticalAlignment: "center",
};
guideSheet.getRange("A8:F8").format.rowHeight = 26;

guideSheet.getRange("A9:F11").merge();
guideSheet.getRange("A9").values = [[
  "Bôi đen toàn bộ bảng A1:F21 trong tab ‘Dữ liệu lỗi’, mở Gemini và nhập:\n“Dựa vào bảng dữ liệu này, hãy chuẩn hóa các biến thể tên về cùng một người, thống kê tổng số tiền mà mỗi người đã ứng ra, sau đó lọc riêng các khoản chi có giá trị trên 1 triệu đồng.”",
]];
guideSheet.getRange("A9:F11").format = {
  fill: "#F7FBFF",
  font: { color: "#1F2937", size: 11 },
  wrapText: true,
  verticalAlignment: "center",
  borders: { preset: "outside", style: "thin", color: "#9FBAD0" },
};
guideSheet.getRange("A9:F11").format.rowHeight = 31;

guideSheet.getRange("A13:B13").merge();
guideSheet.getRange("A13").values = [["Đáp án đối chiếu sau khi chuẩn hóa"]];
guideSheet.getRange("A13:B13").format = {
  fill: "#2F75B5",
  font: { bold: true, color: "#FFFFFF", size: 11 },
  horizontalAlignment: "center",
  verticalAlignment: "center",
};

guideSheet.getRange("A14:B20").values = [
  ["Người ứng chuẩn", "Tổng tiền (VND)"],
  ["Nguyễn Văn An", null],
  ["Trần Thị Bình", null],
  ["Lê Hoàng Minh", null],
  ["Phạm Gia Hân", null],
  ["Đỗ Quốc Khánh", null],
  ["TỔNG CỘNG", null],
];
guideSheet.getRange("B15:B19").formulas = [
  ["=SUM('Dữ liệu lỗi'!$D$2:$D$5)"],
  ["=SUM('Dữ liệu lỗi'!$D$6:$D$9)"],
  ["=SUM('Dữ liệu lỗi'!$D$10:$D$13)"],
  ["=SUM('Dữ liệu lỗi'!$D$14:$D$17)"],
  ["=SUM('Dữ liệu lỗi'!$D$18:$D$21)"],
];
guideSheet.getRange("B20").formulas = [["=SUM('Dữ liệu lỗi'!$D$2:$D$21)"]];

guideSheet.getRange("D13:E13").merge();
guideSheet.getRange("D13").values = [["Chỉ số kiểm tra nhanh"]];
guideSheet.getRange("D13:E13").format = {
  fill: "#2F75B5",
  font: { bold: true, color: "#FFFFFF", size: 11 },
  horizontalAlignment: "center",
  verticalAlignment: "center",
};
guideSheet.getRange("D14:E17").values = [
  ["Chỉ số", "Kết quả đúng"],
  ["Số khoản trên 1 triệu", null],
  ["Tổng tiền các khoản trên 1 triệu", null],
  ["Tổng số dòng dữ liệu", null],
];
guideSheet.getRange("E15").formulas = [["=COUNTIF('Dữ liệu lỗi'!$D$2:$D$21,\">1000000\")"]];
guideSheet.getRange("E16").formulas = [["=SUMIF('Dữ liệu lỗi'!$D$2:$D$21,\">1000000\",'Dữ liệu lỗi'!$D$2:$D$21)"]];
guideSheet.getRange("E17").formulas = [["=COUNTA('Dữ liệu lỗi'!$A$2:$A$21)"]];

guideSheet.getRange("A14:B14").format = {
  fill: "#EAF2F8",
  font: { bold: true, color: "#17365D" },
  borders: { preset: "all", style: "thin", color: "#B7C9D6" },
};
guideSheet.getRange("D14:E14").format = {
  fill: "#EAF2F8",
  font: { bold: true, color: "#17365D" },
  borders: { preset: "all", style: "thin", color: "#B7C9D6" },
};
guideSheet.getRange("A15:B20").format.borders = { preset: "all", style: "thin", color: "#D6E1EA" };
guideSheet.getRange("D15:E17").format.borders = { preset: "all", style: "thin", color: "#D6E1EA" };
guideSheet.getRange("A20:B20").format = {
  fill: "#E2F0D9",
  font: { bold: true, color: "#375623" },
  borders: { preset: "all", style: "thin", color: "#A9D18E" },
};
guideSheet.getRange("B15:B20").format.numberFormat = "#,##0 \"VND\"";
guideSheet.getRange("E16").format.numberFormat = "#,##0 \"VND\"";
guideSheet.getRange("B15:B20").format.horizontalAlignment = "right";
guideSheet.getRange("E15:E17").format.horizontalAlignment = "right";

guideSheet.getRange("A1:A20").format.columnWidth = 28;
guideSheet.getRange("B1:B20").format.columnWidth = 20;
guideSheet.getRange("C1:C20").format.columnWidth = 4;
guideSheet.getRange("D1:D20").format.columnWidth = 34;
guideSheet.getRange("E1:E20").format.columnWidth = 20;
guideSheet.getRange("F1:F20").format.columnWidth = 8;
guideSheet.freezePanes.freezeRows(1);

const inspectData = await workbook.inspect({
  kind: "table",
  range: "Dữ liệu lỗi!A1:F21",
  include: "values,formulas",
  tableMaxRows: 21,
  tableMaxCols: 6,
  maxChars: 12000,
});
console.log("INSPECT_DATA");
console.log(inspectData.ndjson);

const inspectGuide = await workbook.inspect({
  kind: "table",
  range: "Hướng dẫn demo!A13:E20",
  include: "values,formulas",
  tableMaxRows: 10,
  tableMaxCols: 5,
  maxChars: 7000,
});
console.log("INSPECT_GUIDE");
console.log(inspectGuide.ndjson);

const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
console.log("FORMULA_ERRORS");
console.log(formulaErrors.ndjson);

const dataPreview = await workbook.render({
  sheetName: "Dữ liệu lỗi",
  range: "A1:F21",
  scale: 1.5,
  format: "png",
});
await fs.writeFile(`${outputDir}/preview_du_lieu_loi.png`, new Uint8Array(await dataPreview.arrayBuffer()));

const guidePreview = await workbook.render({
  sheetName: "Hướng dẫn demo",
  range: "A1:F20",
  scale: 1.3,
  format: "png",
});
await fs.writeFile(`${outputDir}/preview_huong_dan.png`, new Uint8Array(await guidePreview.arrayBuffer()));

const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(outputPath);
console.log(`OUTPUT=${outputPath}`);
