# Dữ liệu Thuế Nghệ An — GitHub Actions + GitHub Pages

Repository này tự lấy dữ liệu công khai từ `nghean.gdt.gov.vn`, giữ bản hợp lệ gần nhất và phát JSON tĩnh qua GitHub Pages.

## Luồng hoạt động

```text
nghean.gdt.gov.vn
        ↓ GitHub Actions theo lịch
repo/docs/data/*.json
        ↓ GitHub Pages
Cloudflare Worker
        ↓
Zalo Mini App
```

## Cài nhanh

1. Tạo repository **Public** trên GitHub, nên đặt tên `nghean-tax-data`.
2. Upload toàn bộ nội dung thư mục này vào nhánh `main`.
3. Vào **Settings → Actions → General → Workflow permissions**, chọn **Read and write permissions**.
4. Vào **Settings → Pages**:
   - Source: **Deploy from a branch**
   - Branch: `main`
   - Folder: `/docs`
   - Bấm **Save**.
5. Vào tab **Actions**, mở workflow **Cập nhật toàn bộ dữ liệu Thuế Nghệ An**, bấm **Run workflow**.
6. Mở `https://TEN_GITHUB.github.io/TEN_REPOSITORY/health.json`.
7. Cấu hình Worker bằng file `worker/worker-github-pages-full.js` và đặt biến:
   - `GITHUB_DATA_BASE=https://TEN_GITHUB.github.io/TEN_REPOSITORY`
8. Deploy Worker, rồi kiểm tra `/health` và `/news?tab=thue&page=1`.

Xem hướng dẫn đầy đủ trong `HUONG_DAN_TRIEN_KHAI.md`.
