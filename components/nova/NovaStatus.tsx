export function NovaStatus({ text }: { text: string }) {
  return (
    <p className="nova-status-copy" aria-live="polite">
      {text}
    </p>
  );
}
