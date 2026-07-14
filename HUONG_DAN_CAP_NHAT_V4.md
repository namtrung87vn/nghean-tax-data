# HƯỚNG DẪN CẬP NHẬT V4 — LẤY ĐÚNG TOÀN BỘ DANH SÁCH TIN

## 1. Lỗi của bản hiện tại

JSON hiện có các dấu hiệu:

```json
{
  "seed": true,
  "stale": true,
  "fetchedItemCount": 0,
  "sourceMode": ""
}
```

Điều đó có nghĩa là GitHub Actions **chưa lấy được dữ liệu live**. Danh sách 7 tin là dữ liệu khởi tạo: 4 tin từ trang chủ cộng với 3 tin cũ. Đây không phải toàn bộ trang danh sách.

V4 sửa theo nguyên tắc:

- Mở website bằng Chromium thật qua Playwright, không chỉ dùng `fetch()`.
- Chỉ chấp nhận trang tin khi trang đầu có ít nhất 5 khối tin và có dấu hiệu trang danh sách.
- Lấy từng trang 1, 2, 3… theo các liên kết phân trang.
- Không gộp dữ liệu live với seed cũ.
- Tải thumbnail về `docs/media/news-*` và phát qua GitHub Pages.
- Workflow chuyển đỏ nếu vẫn chỉ dùng seed hoặc lấy thiếu trang đầu.

## 2. Upload project GitHub V4

Giải nén `nghean-tax-github-pages-v4-ready.zip`.

Trong repository `namtrung87vn/nghean-tax-data`, upload toàn bộ nội dung bên trong thư mục giải nén và ghi đè file cũ.

Cấu trúc gốc phải có:

```text
.github/workflows/update-data.yml
docs/
scripts/
src/browser-fetcher.mjs
src/collector.mjs
worker/worker-github-pages-v4.js
package.json
package-lock.json
```

Không upload nguyên một thư mục lồng thêm một cấp.

## 3. Chạy workflow

Vào:

```text
Actions
→ Cập nhật dữ liệu Thuế Nghệ An
→ Run workflow
→ mode: full
→ Run workflow
```

Workflow V4 sẽ có bước:

```text
Cài Playwright 1.61.1 và Chromium
Cập nhật toàn bộ dữ liệu bằng trình duyệt thật
Lưu JSON, thumbnail và chẩn đoán
Xác nhận dữ liệu live đúng trang danh sách
```

Lần đầu có thể lâu hơn do GitHub phải tải Chromium.

## 4. Cách xác nhận đã lấy đúng

Mở:

```text
https://namtrung87vn.github.io/nghean-tax-data/
```

Dòng `news-thue` phải có:

```text
Trạng thái: Đã tải live
Nguồn: browser
Trang đầu: ít nhất 8
Tổng lưu: lớn hơn hoặc bằng Trang đầu
Có ảnh: ít nhất 3
```

Mở JSON:

```text
https://namtrung87vn.github.io/nghean-tax-data/data/news-thue.json
```

Kết quả đúng phải gần giống:

```json
{
  "seed": false,
  "stale": false,
  "partial": false,
  "sourceMode": "browser",
  "fetchedItemCount": 20,
  "diagnostics": {
    "browser": {
      "firstPageItemCount": 10,
      "firstPageValidated": true,
      "visitedPages": 2
    }
  }
}
```

Nếu vẫn thấy `seed: true`, workflow chưa thay được dữ liệu.

## 5. Thay Cloudflare Worker V4

Dán toàn bộ file:

```text
worker-github-pages-v4.txt
```

vào Worker `white-bonus-d187` rồi Deploy.

Giữ biến:

```text
GITHUB_DATA_BASE=https://namtrung87vn.github.io/nghean-tax-data
```

Worker V4 tự đổi `imagePath` thành URL thumbnail GitHub Pages.

Kiểm tra:

```text
https://white-bonus-d187.namtrung87vn.workers.dev/news?tab=thue&page=1&pageSize=10
```

Kết quả cần có:

```json
{
  "total": 10,
  "hasNext": true,
  "seed": false,
  "sourceMode": "browser"
}
```

`total` thực tế có thể lớn hơn 10. `hasNext` chỉ là `true` khi còn trang dữ liệu tiếp theo cho Mini App.

## 6. Deploy Mini App V4

Giải nén `thue-tinh-nghean-mini-app-v4-thumbnails.zip`, mở PowerShell trong thư mục rồi chạy:

```bash
npm ci
npm run build
zmp login
zmp deploy
```

Mini App V4:

- Hiển thị 10 tin lần đầu.
- Kéo xuống tự tải 10 tin tiếp theo.
- Có ảnh thumbnail 96 × 68 px.
- Ảnh GitHub Pages dùng trực tiếp; ảnh nguồn cũ mới dùng lớp cache ngoài.

## 7. Nếu GitHub Actions vẫn bị website Thuế chặn

Máy của bạn mở được website trong Chrome, vì vậy dùng bộ cập nhật cục bộ là dự phòng chắc chắn nhất.

Cần clone repository bằng GitHub Desktop hoặc Git:

```bash
git clone https://github.com/namtrung87vn/nghean-tax-data.git
```

Sau đó bấm đúp:

```text
scripts/update-local-windows.bat
```

File này tự:

1. Cài Chromium.
2. Mở trang Thuế bằng trình duyệt thật từ mạng của bạn.
3. Lấy toàn bộ phân trang và thumbnail.
4. Kiểm tra JSON.
5. Commit và push lên GitHub Pages.

Nếu chỉ muốn cập nhật tin tức, chạy:

```text
scripts/update-local-news-windows.bat
```

## 8. Lịch tự động

Workflow V4 khai báo:

```text
Tin tức: phút 07 và 37 mỗi giờ
Toàn bộ: phút 19 mỗi 6 giờ
```

GitHub dùng giờ UTC. Lịch không chạy ngay khi vừa upload; lần chạy theo lịch chỉ xuất hiện sau khi đến mốc cron và có thể chậm vài phút.
