import Image from "next/image";
import { NOVA_FACE_SRC, NOVA_IDENTITY } from "@/components/nova/assets";

export function NovaFace() {
  return (
    <div className="nova-face-wrap">
      <Image
        src={NOVA_FACE_SRC}
        alt={NOVA_IDENTITY.name}
        fill
        preload
        unoptimized
        sizes="(min-width: 2560px) 820px, (min-width: 1920px) 720px, (max-width: 1100px) 92vw, 620px"
        className="nova-face"
      />
    </div>
  );
}
