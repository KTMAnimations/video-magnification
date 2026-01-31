import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, ReferenceLine } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';

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
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <span className="text-rose-500">&#9829;</span>
            BPM Over Time
          </CardTitle>
          <Badge variant="secondary" className="text-xs">avg: {mean}</Badge>
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
                label={{ value: 's', position: 'insideBottomRight', fill: '#94a3b8', fontSize: 10 }}
              />
              <YAxis
                tick={{ fill: '#94a3b8', fontSize: 10 }}
                axisLine={{ stroke: '#334155' }}
                tickLine={false}
                width={40}
                domain={['auto', 'auto']}
              />
              <Tooltip
                contentStyle={{
                  background: '#1e293b',
                  border: '1px solid #334155',
                  color: '#e2e8f0',
                  fontSize: 11,
                }}
                formatter={(v) => [`${v} BPM`, 'Heart Rate']}
              />
              <ReferenceLine y={mean} stroke="#f43f5e" strokeDasharray="5 5" strokeOpacity={0.5} />
              <Line
                type="monotone"
                dataKey="bpm"
                stroke="#f43f5e"
                strokeWidth={2}
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
