import { collectEverything } from "./collector.mjs";
import { closeBrowser } from "./browser-fetcher.mjs";

try {
  await collectEverything();
  console.log("Cập nhật toàn bộ dữ liệu hoàn tất.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeBrowser();
}
