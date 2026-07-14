# BẢN CẬP NHẬT 2 – DỮ LIỆU ĐẦY ĐỦ VÀ TẢI THÊM KHI CUỘN

## Nội dung đã bổ sung

- Tin tức phân trang 5 mục/lần; Mini App tự tải trang tiếp theo khi người dùng cuộn gần cuối danh sách.
- Nút **Xem thêm** vẫn được giữ làm phương án dự phòng khi thiết bị không kích hoạt cuộn tự động.
- Thu thập nhiều trang tin tức thay vì chỉ đọc trang đầu.
- Bổ sung dữ liệu dự phòng từ các HTML đã cung cấp:
  - Bộ thủ tục hành chính thuế hiện hành.
  - Tiếp nhận phản ánh, kiến nghị.
  - Văn bản khác.
  - Danh sách doanh nghiệp thuộc loại rủi ro cao về thuế.
- Bộ thu thập TTHC tự đi theo cả hai liên kết **Xem toàn bộ danh sách**: nhóm Thuế tỉnh/thành phố và nhóm Thuế cơ sở.
- Bộ thu thập doanh nghiệp rủi ro tự đi theo các trang 2, 3, 4... và loại bỏ bản ghi trùng.
- TTHC hiển thị đầy đủ nhiều văn bản quy định và nhiều quyết định công bố trong cùng một thủ tục.
- Văn bản ngành Thuế có dữ liệu dự phòng và tiếp tục được cập nhật tự động khi nguồn truy cập được.

## Dữ liệu có sẵn ngay sau khi cập nhật

- Tin Thuế tỉnh: 7 mục dự phòng.
- Thông tin kinh tế: 9 mục dự phòng.
- Thông báo: 9 mục dự phòng.
- Văn bản hướng dẫn: 7 mục.
- Văn bản khác: 19 mục.
- Văn bản ngành Thuế: 2 mục dự phòng.
- TTHC hiện hành: 6 mục xem trước; GitHub Actions tự lấy toàn bộ danh sách từ hai liên kết “Xem toàn bộ”.
- Phản ánh, kiến nghị: toàn bộ nội dung HTML đã cung cấp.
- Doanh nghiệp rủi ro cao: 10 mục trang đầu; GitHub Actions tự theo các trang tiếp theo.

## Triển khai

### 1. Cập nhật repository GitHub

Giải nén gói `nghean-tax-github-pages-v2-ready.zip`, sau đó tải **nội dung bên trong** lên thư mục gốc repository `nghean-tax-data` và chọn ghi đè file cũ.

Cấu trúc gốc phải có:

```text
.github/
docs/
src/
worker/
package.json
package-lock.json
```

Nếu repository đang có workflow tự tạo trước đây như `.github/workflows/update-data.yml`, có thể xóa workflow cũ để tránh chạy trùng. Gói V2 chỉ dùng một workflow để tránh chạy trùng:

```text
.github/workflows/update-data.yml
```

### 2. Chạy cập nhật toàn bộ

Vào:

```text
Actions → Cập nhật dữ liệu Thuế Nghệ An → Run workflow → mode: full
```

Chờ dấu tích xanh. Sau đó kiểm tra:

```text
https://namtrung87vn.github.io/nghean-tax-data/health.json
https://namtrung87vn.github.io/nghean-tax-data/data/docs-khac.json
https://namtrung87vn.github.io/nghean-tax-data/data/tthc.json
https://namtrung87vn.github.io/nghean-tax-data/data/dnrrvt.json
```

### 3. Cập nhật Cloudflare Worker

Dán toàn bộ nội dung `worker-github-pages-v2.txt` vào Worker hiện tại. Giữ biến:

```text
GITHUB_DATA_BASE=https://namtrung87vn.github.io/nghean-tax-data
```

Deploy và kiểm tra:

```text
https://white-bonus-d187.namtrung87vn.workers.dev/news?tab=thue&page=1&pageSize=5
https://white-bonus-d187.namtrung87vn.workers.dev/news?tab=thue&page=2&pageSize=5
https://white-bonus-d187.namtrung87vn.workers.dev/docs?tab=khac&page=1&pageSize=8
https://white-bonus-d187.namtrung87vn.workers.dev/docs?tab=nganh&page=1&pageSize=8
https://white-bonus-d187.namtrung87vn.workers.dev/tthc?tab=hienthanh&page=1&pageSize=20
https://white-bonus-d187.namtrung87vn.workers.dev/dnrrvt?page=1&pageSize=8
```

Trang 1 của Tin Thuế phải trả `hasNext: true`; trang 2 phải có các mục tiếp theo.

### 4. Build và triển khai lại Zalo Mini App

Trong thư mục Mini App V2:

```bash
npm ci
npm run build
zmp login
zmp deploy
```

Thư mục `www/` trong gói đã được build sẵn, nhưng vẫn nên chạy lại `npm run build` trước khi deploy để xác nhận môi trường máy tính.

## Cơ chế an toàn dữ liệu

- Nếu nguồn Thuế timeout, file JSON đang dùng không bị ghi đè bởi danh sách rỗng.
- Mini App đọc dữ liệu GitHub Pages thông qua Worker, không chờ trực tiếp website Thuế.
- Worker phân trang từ toàn bộ dữ liệu JSON đã lưu.
- Mini App tự nối trang mới, loại bỏ tin trùng và không gọi đồng thời nhiều trang.
