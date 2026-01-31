import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, ReferenceLine } from 'recharts';

interface Props {
  bpmValues: number[];
  times?: number[];
}

export function BPMTimeChart({ bpmValues, times }: Props) {
  const data = bpmValues.map((bpm, i) => ({
    time: times ? times[i] : i,
    bpm: Math.round(bpm * 10) / 10,
  }));
  const mean = bpmValues.length > 0
    ? Math.round((bpmValues.reduce((a, b) => a + b, 0) / bpmValues.length) * 10) / 10
    : 0;

  return (
    <div className="panel">
      <div className="panel-header">
        <span style={{ color: 'var(--color-heart)' }}>&#9829;</span>
        BPM Over Time
        <span className="ml-auto text-[var(--color-text-dim)]">avg: {mean}</span>
      </div>
      <div className="p-2" style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="time"
              tick={{ fill: 'var(--color-text-dim)', fontSize: 10 }}
              axisLine={{ stroke: 'var(--color-border)' }}
              tickLine={false}
              label={{ value: 's', position: 'insideBottomRight', fill: 'var(--color-text-dim)', fontSize: 10 }}
            />
            <YAxis
              tick={{ fill: 'var(--color-text-dim)', fontSize: 10 }}
              axisLine={{ stroke: 'var(--color-border)' }}
              tickLine={false}
              width={40}
              domain={['auto', 'auto']}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--color-bg-panel)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
              }}
              formatter={(v) => [`${v} BPM`, 'Heart Rate']}
            />
            <ReferenceLine y={mean} stroke="var(--color-heart)" strokeDasharray="5 5" strokeOpacity={0.5} />
            <Line
              type="monotone"
              dataKey="bpm"
              stroke="var(--color-heart)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
