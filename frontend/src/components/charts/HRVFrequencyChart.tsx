import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, ReferenceArea } from 'recharts';

interface Props {
  freqs: number[];
  power: number[];
  lfPower?: number;
  hfPower?: number;
}

export function HRVFrequencyChart({ freqs, power, lfPower, hfPower }: Props) {
  const data = freqs.map((f, i) => ({ freq: Math.round(f * 1000) / 1000, power: power[i] }));

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="text-[var(--color-warning)]">&#9618;</span>
        Power Spectral Density
        {lfPower !== undefined && hfPower !== undefined && (
          <span className="ml-auto text-[var(--color-text-dim)]">
            LF/HF: {hfPower > 0 ? (lfPower / hfPower).toFixed(2) : 'N/A'}
          </span>
        )}
      </div>
      <div className="p-2" style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="freq"
              tick={{ fill: 'var(--color-text-dim)', fontSize: 10 }}
              axisLine={{ stroke: 'var(--color-border)' }}
              tickLine={false}
              label={{ value: 'Hz', position: 'insideBottomRight', fill: 'var(--color-text-dim)', fontSize: 10 }}
            />
            <YAxis
              tick={{ fill: 'var(--color-text-dim)', fontSize: 10 }}
              axisLine={{ stroke: 'var(--color-border)' }}
              tickLine={false}
              width={50}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--color-bg-panel)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
              }}
            />
            {/* LF band highlight */}
            <ReferenceArea x1={0.04} x2={0.15} fill="var(--color-warning)" fillOpacity={0.1} />
            {/* HF band highlight */}
            <ReferenceArea x1={0.15} x2={0.4} fill="var(--color-accent)" fillOpacity={0.1} />
            <Area
              type="monotone"
              dataKey="power"
              stroke="var(--color-accent)"
              fill="var(--color-accent)"
              fillOpacity={0.15}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
