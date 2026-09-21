export function NovaProjectCard({
  name,
  status,
  warm = false,
}: {
  name: string;
  status: string;
  warm?: boolean;
}) {
  return (
    <div className="nova-item">
      <span className={`nova-item-pip ${warm ? "warm" : ""}`} />
      <div>
        <strong>{name}</strong>
        <span>{status}</span>
      </div>
    </div>
  );
}
