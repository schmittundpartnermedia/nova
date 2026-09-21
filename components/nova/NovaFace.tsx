import Image from "next/image";
import { NOVA_FACE_SRC, NOVA_IDENTITY } from "@/components/nova/assets";

export function NovaFace({
  region = "full",
}: {
  region?: "full" | "upper" | "lower";
}) {
  return (
    <div className={`nova-face-wrap region-${region}`}>
      <Image
        src={NOVA_FACE_SRC}
        alt={region === "full" ? NOVA_IDENTITY.name : ""}
        fill
        preload={region !== "lower"}
        unoptimized
        sizes="(min-width: 2560px) 820px, (min-width: 1920px) 720px, (max-width: 1100px) 92vw, 620px"
        className="nova-face"
      />
    </div>
  );
}
