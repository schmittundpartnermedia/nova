export function NovaSpeech({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="nova-speech">
      <span className="nova-speech-name">NOVA</span>
      <p>{text}</p>
    </div>
  );
}
