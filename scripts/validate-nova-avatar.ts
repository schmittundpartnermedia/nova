import { PRODUCTION_AVATAR_PATH } from "@/features/avatar/acceptance";
import { validateAvatarGlb } from "@/features/avatar/validate-glb";

function main() {
  const report = validateAvatarGlb(PRODUCTION_AVATAR_PATH, "production");
  console.log(JSON.stringify(report, null, 2));
  if (report.code === "FINAL_AVATAR_MISSING") {
    console.error("FINAL_AVATAR_MISSING: public/nova/avatar/nova.glb ist nicht vorhanden oder nicht validiert.");
    process.exit(2);
  }
  if (!report.ok) process.exit(1);
}

main();
