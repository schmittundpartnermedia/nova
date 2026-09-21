export function NovaTaskCard({
  title,
  meta,
}: {
  title: string;
  meta: string;
}) {
  return (
    <div className="nova-item">
      <span className="nova-item-pip warm" />
      <div>
        <strong>{title}</strong>
        <span>{meta}</span>
      </div>
    </div>
  );
}
