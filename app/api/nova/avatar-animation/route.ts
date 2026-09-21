import { getAvatarAnimationHealth, audio2FaceArchitectureNote } from "@/services/avatar-animation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const health = await getAvatarAnimationHealth();
  return Response.json({
    ...health,
    architecture: audio2FaceArchitectureNote(),
    browser: false,
  });
}
