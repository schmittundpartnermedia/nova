import { notFound } from "next/navigation";
import { VoiceLab } from "@/app/dev/voice/VoiceLab";

export const dynamic = "force-dynamic";

export default function VoiceLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <VoiceLab />;
}
