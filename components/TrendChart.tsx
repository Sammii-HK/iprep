'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface TrendChartProps {
  data: Array<{ date: string; value: number }>;
  label: string;
  color?: string;
}

export function TrendChart({ data, label, color = '#3b82f6' }: TrendChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500 dark:text-slate-400">
        No data available
      </div>
    );
  }

  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 12 }}
            tickFormatter={(value) => {
              const date = new Date(value);
              return `${date.getMonth() + 1}/${date.getDate()}`;
            }}
          />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip
            labelFormatter={(value) => {
              const date = new Date(value);
              return date.toLocaleDateString();
            }}
            formatter={(value: number) => [value.toFixed(1), label]}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
