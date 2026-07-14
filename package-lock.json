# HƯỚNG DẪN CẬP NHẬT V3 – THUẾ NGHỆ AN

## 1. Nguyên nhân chỉ có 7 tin

File `docs/data/news-thue.json` hiện tại là dữ liệu dự phòng (`seed: true`, `stale: true`). GitHub Actions hoàn thành màu xanh vì chương trình giữ dữ liệu cũ khi nguồn lỗi, chứ không phải đã tải đủ. V3 thay đổi điều này: sau khi commit dữ liệu dự phòng, workflow sẽ chuyển đỏ nếu các nguồn quan trọng chưa được tải live.

## 2. Điểm mới V3

- Thử tải trực tiếp từ `nghean.gdt.gov.vn`.
- Nếu GitHub runner bị timeout/chặn, tự thử qua Jina Reader.
- Cào các URL phân trang cho tin tức, văn bản, TTHC và doanh nghiệp rủi ro cao.
- Gộp dữ liệu mới với dữ liệu cũ, không làm mất tin.
- Ghi `sourceMode`, `fetchedItemCount`, `partial`, `stale`, `lastError`.
- Workflow chỉ xanh khi các nguồn quan trọng thực sự được tải live.
- Mini App tải 10 tin/lần, tự tải tiếp khi cuộn.
- Tin luôn có khung ảnh nhỏ. Ảnh thật dùng CDN ảnh độc lập; nếu ảnh nguồn lỗi sẽ hiện biểu tượng mặc định.

## 3. Cập nhật repository GitHub

Giải nén `nghean-tax-github-pages-v3-ready.zip`.

Vào repository:

`https://github.com/namtrung87vn/nghean-tax-data`

Chọn `Code → Add file → Upload files`, kéo toàn bộ nội dung bên trong thư mục giải nén lên và ghi đè file cũ.

Cấu trúc ngoài cùng phải gồm:

```text
.github
 docs
 scripts
 src
 worker
 package.json
 package-lock.json
```

## 4. Tùy chọn nhưng nên làm: thêm JINA_API_KEY miễn phí

V3 chạy được không cần key, nhưng GitHub runner dùng chung IP nên có thể chạm hạn mức. Một key Reader miễn phí giúp ổn định hơn.

Trong GitHub vào:

`Settings → Secrets and variables → Actions → New repository secret`

Điền:

```text
Name: JINA_API_KEY
Secret: khóa Jina của bạn
```

Không đặt key trong code hoặc file `.env` rồi upload công khai.

## 5. Chạy thử

Vào:

`Actions → Cập nhật dữ liệu Thuế Nghệ An → Run workflow`

Chọn:

```text
Branch: main
mode: full
```

Lần chạy có thể mất 15–45 phút vì phải thử nguồn trực tiếp, Reader và nhiều trang phân trang.

Mở lần chạy, xem phần `Summary`. Bảng phải ghi `LIVE`, `fetchedItemCount > 0` cho các nguồn quan trọng.

- Màu xanh: đã tải live các nguồn quan trọng.
- Màu đỏ ở bước cuối: nguồn vẫn bị chặn hoặc chỉ lấy được một phần. Dữ liệu cũ vẫn được commit và Mini App vẫn hoạt động; màu đỏ nhằm tránh hiểu nhầm đã lấy đủ.

## 6. Kiểm tra GitHub Pages

Mở:

```text
https://namtrung87vn.github.io/nghean-tax-data/
https://namtrung87vn.github.io/nghean-tax-data/health.json
https://namtrung87vn.github.io/nghean-tax-data/data/news-thue.json
```

Dữ liệu đạt yêu cầu khi:

```json
{
  "seed": false,
  "stale": false,
  "sourceMode": "reader",
  "fetchedItemCount": 10
}
```

`sourceMode` cũng có thể là `direct` hoặc `direct+reader`.

## 7. Cập nhật Cloudflare Worker

Dùng file `worker-github-pages-v3.txt` hoặc `.js`.

Trong Worker giữ biến:

```text
GITHUB_DATA_BASE=https://namtrung87vn.github.io/nghean-tax-data
```

Deploy rồi kiểm tra:

```text
https://white-bonus-d187.namtrung87vn.workers.dev/health
https://white-bonus-d187.namtrung87vn.workers.dev/news?tab=thue&page=1&pageSize=10
```

## 8. Cập nhật Zalo Mini App

Giải nén `thue-tinh-nghean-mini-app-v3-thumbnails.zip`, mở terminal trong thư mục và chạy:

```bash
npm ci
npm run build
zmp login
zmp deploy
```

V3 hiển thị:

- Ảnh thumbnail 96 × 68 px.
- Tiêu đề tối đa hai dòng.
- Mô tả ngắn khi nguồn có dữ liệu.
- 10 tin ở lần tải đầu.
- Tự tải trang kế tiếp khi cuộn gần cuối.
- Nút “Xem thêm” dự phòng.

## 9. Lịch GitHub Actions

```text
17 và 47 phút mỗi giờ: cập nhật tin tức
Phút 23 mỗi 6 giờ: cập nhật toàn bộ
```

Cron của GitHub mặc định dùng UTC. Lịch có thể chạy chậm hoặc đôi khi bị bỏ; không nên xem lịch là sự bảo đảm lấy đủ. Hãy kiểm tra `Summary`, `health.json`, `seed`, `stale` và `fetchedItemCount`.

## 10. Dự phòng chắc chắn nhất không cần VPS

Nếu cả GitHub runner và Jina đều bị nguồn Thuế chặn nhưng máy Windows của bạn vẫn mở được trang, chạy:

```text
scripts\update-local-windows.bat
```

Máy cần cài Node.js và Git/GitHub Desktop, repository phải được clone về máy và đăng nhập GitHub. Script sẽ tải dữ liệu bằng mạng của bạn, kiểm tra JSON, commit và push lên GitHub Pages.
