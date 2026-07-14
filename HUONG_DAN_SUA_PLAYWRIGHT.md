# Sửa lỗi “Chưa cài Playwright” trên GitHub Actions

Không cài Playwright thủ công trên máy tính. GitHub Actions sẽ tự cài mới trong mỗi lần chạy.

## File bắt buộc phải ghi đè

1. `package.json`
2. `package-lock.json`
3. `.github/workflows/update-data.yml`

Bản 4.1 đã đưa `playwright` vào `devDependencies`, nên bước `npm ci` luôn cài đúng module. Sau đó workflow chạy:

```bash
npx playwright install --with-deps chromium
```

Workflow còn kiểm tra ba việc trước khi thu thập:

- phiên bản Playwright;
- import module Playwright;
- khởi chạy Chromium thật.

Nếu một trong ba việc lỗi, workflow dừng ngay tại bước kiểm tra, không còn báo xanh nhưng dùng dữ liệu seed.

## Cách cập nhật trên GitHub

Giải nén gói V4.1 rồi tải toàn bộ nội dung lên repository và chọn ghi đè. Sau khi commit, kiểm tra:

- `package.json` có `devDependencies.playwright`;
- `package-lock.json` có `node_modules/playwright`;
- workflow có bước “Cài Chromium và thư viện hệ điều hành”.

Sau đó vào **Actions → Cập nhật dữ liệu Thuế Nghệ An → Run workflow → mode: full**.

## Dấu hiệu cài thành công

Trong chi tiết lần chạy phải có dấu xanh ở ba bước:

1. `Cài thư viện Node.js, gồm Playwright`
2. `Cài Chromium và thư viện hệ điều hành`
3. `Kiểm tra Playwright trước khi thu thập`

Log bước 3 phải chứa:

```text
Version 1.61.1
Playwright module: OK
Chromium launch: OK
```
