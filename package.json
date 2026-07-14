{
  "name": "nghean-tax-github-pages",
  "version": "3.0.0",
  "private": true,
  "type": "module",
  "description": "Thu thập dữ liệu Thuế Nghệ An bằng GitHub Actions và phát JSON qua GitHub Pages",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "collect:news": "node src/refresh-news.mjs && node src/build-static.mjs",
    "collect:full": "node src/refresh-full.mjs && node src/build-static.mjs",
    "build:static": "node src/build-static.mjs",
    "validate": "node src/validate.mjs",
    "test": "npm run build:static && npm run validate",
    "report": "node src/report-refresh.mjs",
    "assert:refresh": "node src/assert-refresh.mjs"
  }
}
