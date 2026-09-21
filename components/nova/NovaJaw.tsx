import { NovaFace } from "@/components/nova/NovaFace";

export function NovaJaw({
  speaking,
}: {
  intensity: number;
  speaking: boolean;
}) {
  return (
    <div className="nova-jaw" data-speaking={speaking ? "true" : "false"}>
      <NovaFace region="lower" />
      <span className="nova-jaw-hint" />
    </div>
  );
}
