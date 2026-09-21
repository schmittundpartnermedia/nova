import Image from "next/image";
import { NOVA_IDENTITY } from "@/components/nova/assets";

export function NovaPortrait() {
  return (
    <div className="nova-face-wrap">
      <Image
        src={NOVA_IDENTITY.referenceFaceSrc}
        alt="NOVA"
        fill
        priority
        unoptimized
        sizes="(min-width: 2560px) 860px, (min-width: 1920px) 760px, (max-width: 1100px) 92vw, 680px"
        className="nova-face"
      />
    </div>
  );
}
