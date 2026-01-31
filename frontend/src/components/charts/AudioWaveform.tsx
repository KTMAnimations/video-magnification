import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';

interface Props {
  waveform: number[];
  durationSeconds?: number;
}

export function AudioWaveform({ waveform, durationSeconds }: Props) {
  const data = waveform.map((v, i) => ({
    time: durationSeconds ? (i / waveform.length) * durationSeconds : i,
    amplitude: v,
  }));

  return (
    <div className="panel">
      <div className="panel-header">
        <span style={{ color: 'var(--color-audio)' }}>&#8767;</span>
        Recovered Audio Waveform
        {durationSeconds && (
          <span className="ml-auto text-[var(--color-text-dim)]">{durationSeconds.toFixed(1)}s</span>
        )}
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
            />
            <YAxis
              tick={{ fill: 'var(--color-text-dim)', fontSize: 10 }}
              axisLine={{ stroke: 'var(--color-border)' }}
              tickLine={false}
              width={40}
              domain={[-1, 1]}
            />
            <Line
              type="monotone"
              dataKey="amplitude"
              stroke="var(--color-audio)"
              strokeWidth={1}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
