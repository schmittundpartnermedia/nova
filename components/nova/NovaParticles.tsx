const POINTS = [
  { top: "12%", left: "18%", delay: "0s" },
  { top: "22%", left: "78%", delay: "1.4s" },
  { top: "38%", left: "8%", delay: "2.1s" },
  { top: "48%", left: "88%", delay: "0.6s" },
  { top: "64%", left: "16%", delay: "3.2s" },
  { top: "70%", left: "72%", delay: "1.8s" },
  { top: "18%", left: "52%", delay: "2.8s" },
  { top: "82%", left: "42%", delay: "0.9s" },
  { top: "30%", left: "30%", delay: "4s" },
  { top: "58%", left: "60%", delay: "2.4s" },
  { top: "8%", left: "66%", delay: "3.6s" },
  { top: "76%", left: "84%", delay: "1.1s" },
];

export function NovaParticles() {
  return (
    <div className="nova-particles" aria-hidden="true">
      {POINTS.map((point, index) => (
        <span
          key={index}
          className="nova-particle"
          style={{ top: point.top, left: point.left, animationDelay: point.delay }}
        />
      ))}
    </div>
  );
}
