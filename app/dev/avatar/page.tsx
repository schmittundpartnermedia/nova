import { notFound } from "next/navigation";
import { AvatarLab } from "@/app/dev/avatar/AvatarLab";

export const dynamic = "force-dynamic";

export default function AvatarLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AvatarLab />;
}
