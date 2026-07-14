import { collectEverything } from "./collector.mjs";

collectEverything()
  .then(() => {
    console.log("Cập nhật toàn bộ dữ liệu hoàn tất.");
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
