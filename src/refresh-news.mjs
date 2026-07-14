import { collectAllNews } from "./collector.mjs";
import { closeBrowser } from "./browser-fetcher.mjs";

try {
  await collectAllNews();
  console.log("Cập nhật tin tức hoàn tất.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeBrowser();
}
