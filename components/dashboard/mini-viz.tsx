'use client';

// Tiny per-card visualizations for the collapsed bento tiles.

export function MiniRing({
  value,
  max,
  color,
  size = 46,
}: {
  value: number;
  max: number;
  color: string;
  size?: number;
}) {
  const r = 18;
  const C = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden>
      <circle cx="22" cy="22" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="4" />
      <circle
        cx="22"
        cy="22"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - pct)}
        transform="rotate(-90 22 22)"
        style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.22,1,0.36,1)' }}
      />
    </svg>
  );
}

export function MiniSegBar({
  done,
  total,
  color,
  width = 74,
}: {
  done: number;
  total: number;
  color: string;
  width?: number;
}) {
  const segs = Math.max(1, Math.min(total || 1, 10));
  const filled = total > 0 ? Math.round((done / total) * segs) : 0;
  return (
    <div className="flex items-center gap-[3px]" style={{ width }} aria-hidden>
      {Array.from({ length: segs }).map((_, i) => (
        <span
          key={i}
          className="h-[5px] flex-1 rounded-full"
          style={{
            background: i < filled ? color : 'rgba(255,255,255,0.08)',
            boxShadow: i < filled ? `0 0 6px ${color}55` : undefined,
          }}
        />
      ))}
    </div>
  );
}

export function MiniWeekBars({
  values,
  color,
  height = 30,
}: {
  values: number[]; // 7 values, oldest → newest
  color: string;
  height?: number;
}) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-[3px]" style={{ height }} aria-hidden>
      {values.map((v, i) => (
        <span
          key={i}
          className="w-[7px] rounded-[2px]"
          style={{
            height: `${v > 0 ? Math.max(18, (v / max) * 100) : 10}%`,
            background: v > 0 ? color : 'rgba(255,255,255,0.08)',
            opacity: i === values.length - 1 ? 1 : 0.8,
          }}
        />
      ))}
    </div>
  );
}

export function MiniSparkline({
  values,
  color,
  width = 84,
  height = 34,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) {
    return (
      <svg width={width} height={height} aria-hidden>
        <line
          x1="0"
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />
      </svg>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 3;
  const pts = values.map((v, i) => [
    pad + ((width - pad * 2) * i) / (values.length - 1),
    height - pad - ((height - pad * 2) * (v - min)) / range,
  ]);
  const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${d} L${pts[pts.length - 1][0].toFixed(1)} ${height} L${pts[0][0].toFixed(1)} ${height} Z`;
  const gid = `spark-${color.replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <svg width={width} height={height} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
