import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';

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
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <span className="text-purple-500">&#8767;</span>
            Recovered Audio Waveform
          </CardTitle>
          {durationSeconds && (
            <Badge variant="secondary" className="text-xs">{durationSeconds.toFixed(1)}s</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="dark-panel" style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="time"
                tick={{ fill: '#94a3b8', fontSize: 10 }}
                axisLine={{ stroke: '#334155' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#94a3b8', fontSize: 10 }}
                axisLine={{ stroke: '#334155' }}
                tickLine={false}
                width={40}
                domain={[-1, 1]}
              />
              <Line
                type="monotone"
                dataKey="amplitude"
                stroke="#a855f7"
                strokeWidth={1}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
