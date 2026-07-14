# HƯỚNG DẪN TRIỂN KHAI ĐẦY ĐỦ

## A. Tạo repository GitHub

1. Đăng nhập GitHub.
2. Bấm dấu **+** ở góc phải → **New repository**.
3. Điền:
   - Repository name: `nghean-tax-data`
   - Chọn **Public**.
   - Không cần chọn thêm README vì gói này đã có README.
4. Bấm **Create repository**.

## B. Upload bộ mã

1. Giải nén file ZIP được cung cấp.
2. Trong repository vừa tạo, chọn **Add file → Upload files**.
3. Kéo toàn bộ nội dung bên trong thư mục đã giải nén vào trang upload.
4. Phải nhìn thấy các thư mục sau trước khi commit:
   - `.github`
   - `docs`
   - `src`
   - `worker`
5. Bấm **Commit changes**.

> Không upload thêm một lớp thư mục ở ngoài. File `package.json` phải nằm ngay trang gốc của repository.

## C. Cho GitHub Actions quyền ghi dữ liệu

1. Mở **Settings** của repository.
2. Chọn **Actions → General**.
3. Kéo xuống **Workflow permissions**.
4. Chọn **Read and write permissions**.
5. Bấm **Save**.

## D. Bật GitHub Pages

1. Mở **Settings → Pages**.
2. Tại **Build and deployment**:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/docs`
3. Bấm **Save**.
4. GitHub sẽ tạo địa chỉ dạng:

```text
https://TEN_GITHUB.github.io/nghean-tax-data/
```

## E. Chạy cập nhật lần đầu

1. Mở tab **Actions**.
2. Chọn **Cập nhật toàn bộ dữ liệu Thuế Nghệ An**.
3. Bấm **Run workflow → Run workflow**.
4. Chờ dấu tròn chuyển thành dấu tích xanh.
5. Kiểm tra:

```text
https://TEN_GITHUB.github.io/nghean-tax-data/health.json
https://TEN_GITHUB.github.io/nghean-tax-data/data/news-thue.json
```

Nếu nguồn Thuế đang lỗi, các file vẫn có dữ liệu khởi tạo và được đánh dấu `stale: true`. Khi GitHub Actions kết nối được nguồn, file sẽ tự chuyển sang dữ liệu mới.

## F. Cấu hình Cloudflare Worker

### 1. Thay code Worker

1. Vào Cloudflare Dashboard.
2. Chọn **Workers & Pages**.
3. Mở Worker Mini App đang dùng.
4. Chọn **Edit code**.
5. Xóa code cũ.
6. Dán toàn bộ nội dung file:

```text
worker/worker-github-pages-full.js
```

File này là bản đầy đủ, vẫn giữ các route khác của Worker cũ và chuyển các route dữ liệu Nghệ An sang GitHub Pages.

### 2. Thêm biến GitHub Pages

Trong Worker, mở **Settings → Variables and Secrets → Add variable**:

```text
Name: GITHUB_DATA_BASE
Value: https://TEN_GITHUB.github.io/nghean-tax-data
```

Không thêm dấu `/` ở cuối.

Bấm **Deploy**.

## G. Kiểm tra Worker

Giả sử Worker hiện tại là:

```text
https://white-bonus-d187.namtrung87vn.workers.dev
```

Mở lần lượt:

```text
https://white-bonus-d187.namtrung87vn.workers.dev/health
https://white-bonus-d187.namtrung87vn.workers.dev/news?tab=thue&page=1
https://white-bonus-d187.namtrung87vn.workers.dev/news?tab=kinhte&page=1
https://white-bonus-d187.namtrung87vn.workers.dev/news?tab=thongbao&page=1
https://white-bonus-d187.namtrung87vn.workers.dev/docs?tab=huongdan&page=1
https://white-bonus-d187.namtrung87vn.workers.dev/tthc?tab=hienthanh&page=1&pageSize=20
https://white-bonus-d187.namtrung87vn.workers.dev/videos?page=1
https://white-bonus-d187.namtrung87vn.workers.dev/dvc?page=1&pageSize=12
```

Kết quả đúng phải có JSON và không còn báo `Timeout 12000ms` từ `nghean.gdt.gov.vn`.

## H. Zalo Mini App

Nếu Mini App vẫn đang dùng đúng URL Worker cũ thì không cần sửa hoặc build lại Mini App. Chỉ cần đóng và mở lại ứng dụng.

Nếu URL Worker đã đổi, sửa API base trong Mini App thành URL mới rồi build/deploy lại.

## I. Lịch tự động có sẵn

- Tin tức: hai lần mỗi giờ, phút 17 và 47.
- Toàn bộ văn bản, TTHC, video và dịch vụ công: mỗi 6 giờ.
- Có thể chạy thủ công trong tab **Actions** bất cứ lúc nào.

## J. Khi workflow lỗi

### Lỗi `Permission denied` hoặc không push được

Vào:

```text
Settings → Actions → General → Workflow permissions
```

Chọn **Read and write permissions**.

### Pages báo 404

Kiểm tra:

```text
Settings → Pages → Deploy from a branch → main → /docs
```

Sau khi bật Pages, chờ khoảng 1–3 phút.

### Workflow xanh nhưng dữ liệu vẫn `stale: true`

Điều này có nghĩa GitHub Pages hoạt động nhưng runner GitHub chưa lấy được nguồn Thuế ở lần đó. Dữ liệu hợp lệ cũ vẫn được giữ, Mini App không bị trắng.

### Worker báo thiếu cấu hình

Kiểm tra biến Worker:

```text
GITHUB_DATA_BASE=https://TEN_GITHUB.github.io/nghean-tax-data
```

Không đặt dấu `/` cuối URL và không đặt đường dẫn `/data` trong biến.
