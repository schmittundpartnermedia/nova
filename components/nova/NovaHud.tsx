function coord(value: number) {
  return value.toFixed(2);
}

const TICKS = Array.from({ length: 24 }, (_, index) => {
  const angle = (index / 24) * Math.PI * 2;
  const inner = 248;
  const outer = index % 3 === 0 ? 264 : 256;
  return {
    x1: coord(400 + Math.cos(angle) * inner),
    y1: coord(390 + Math.sin(angle) * inner),
    x2: coord(400 + Math.cos(angle) * outer),
    y2: coord(390 + Math.sin(angle) * outer),
  };
});

const DOTS = Array.from({ length: 10 }, (_, index) => {
  const angle = (index / 10) * Math.PI * 2 + 0.4;
  return {
    cx: coord(400 + Math.cos(angle) * 322),
    cy: coord(390 + Math.sin(angle) * 322),
    r: index % 2 === 0 ? "2.2" : "1.3",
  };
});

export function NovaHud() {
  return (
    <div className="nova-hud" aria-hidden="true">
      <svg viewBox="0 0 800 800">
        <circle className="nova-hud-ring a" cx="400" cy="390" r="268" strokeDasharray="8 14 2 28 4 18" />
        <circle className="nova-hud-ring b" cx="400" cy="390" r="304" strokeDasharray="120 40 8 64" />
        <circle className="nova-hud-ring c" cx="400" cy="390" r="338" strokeDasharray="16 92 6 140" />
        <g className="nova-hud-ticks">
          {TICKS.map((tick, index) => (
            <line key={index} x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} />
          ))}
        </g>
        <g className="nova-hud-dots">
          {DOTS.map((dot, index) => (
            <circle key={index} cx={dot.cx} cy={dot.cy} r={dot.r} />
          ))}
        </g>
      </svg>
    </div>
  );
}
