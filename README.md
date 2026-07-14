# Dữ liệu Thuế Nghệ An V4 — Chromium + GitHub Pages

V4 dùng Chromium/Playwright trên GitHub Actions để mở đúng các trang danh sách của `nghean.gdt.gov.vn`, đi qua phân trang, lưu JSON và thumbnail vào GitHub Pages.

Điểm chính:

- Không trộn 4 tin trang chủ với seed cũ.
- Chỉ ghi đè tin tức khi xác nhận đúng trang danh sách.
- Lưu thumbnail trong `docs/media`.
- Workflow đỏ nếu `seed`, `stale`, lấy thiếu trang đầu hoặc không có ảnh.
- Có script Windows để cập nhật bằng mạng của người dùng khi GitHub runner bị nguồn chặn.

Xem `HUONG_DAN_CAP_NHAT_V4.md`.
