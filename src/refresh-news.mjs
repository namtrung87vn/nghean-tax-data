import { collectAllNews } from "./collector.mjs";

collectAllNews()
  .then(() => {
    console.log("Cập nhật tin tức hoàn tất.");
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
