import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, ReferenceArea } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';

interface Props {
  freqs: number[];
  power: number[];
  lfPower?: number;
  hfPower?: number;
}

export function HRVFrequencyChart({ freqs, power, lfPower, hfPower }: Props) {
  const data = freqs.map((f, i) => ({ freq: Math.round(f * 1000) / 1000, power: power[i] }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <span className="text-teal-500">&#9618;</span>
            Power Spectral Density
          </CardTitle>
          {lfPower !== undefined && hfPower !== undefined && (
            <Badge variant="secondary" className="text-xs">
              LF/HF: {hfPower > 0 ? (lfPower / hfPower).toFixed(2) : 'N/A'}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="dark-panel">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="freq"
                tick={{ fill: '#94a3b8', fontSize: 10 }}
                axisLine={{ stroke: '#334155' }}
                tickLine={false}
                label={{ value: 'Hz', position: 'insideBottomRight', fill: '#94a3b8', fontSize: 10 }}
              />
              <YAxis
                tick={{ fill: '#94a3b8', fontSize: 10 }}
                axisLine={{ stroke: '#334155' }}
                tickLine={false}
                width={50}
              />
              <Tooltip
                contentStyle={{
                  background: '#1e293b',
                  border: '1px solid #334155',
                  color: '#e2e8f0',
                  fontSize: 11,
                }}
              />
              {/* LF band highlight */}
              <ReferenceArea x1={0.04} x2={0.15} fill="#f59e0b" fillOpacity={0.1} />
              {/* HF band highlight */}
              <ReferenceArea x1={0.15} x2={0.4} fill="#14b8a6" fillOpacity={0.1} />
              <Area
                type="monotone"
                dataKey="power"
                stroke="#14b8a6"
                fill="#14b8a6"
                fillOpacity={0.15}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
