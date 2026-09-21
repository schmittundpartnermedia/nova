import { closeBrowserSession } from "@/services/desktop-service/adapters/browser";
import { startDesktopService } from "@/services/desktop-service/server";
import { logDesktop } from "@/services/desktop-service/logger";

startDesktopService()
  .then((server) => {
    const shutdown = () => {
      logDesktop("shutdown", { pid: process.pid });
      void closeBrowserSession();
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 2000).unref();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  })
  .catch((error: unknown) => {
    logDesktop("fatal", { message: error instanceof Error ? error.message : "start failed" });
    process.exit(1);
  });
