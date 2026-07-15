'use client';

import React from 'react';
import { 
    ResponsiveContainer, 
    AreaChart, 
    Area, 
    XAxis, 
    YAxis, 
    CartesianGrid, 
    Tooltip 
} from 'recharts';

interface PerformanceChartProps {
    data: {
        label: string;
        amount: number;
    }[];
}

/**
 * COMPONENTE DE GRÁFICO AISLADO v1.0
 * Saneado: Exportación por defecto para facilitar el Next dynamic import.
 */
export default function PerformanceChart({ data }: PerformanceChartProps) {
    return (
        <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
                <defs>
                    <linearGradient id="colorPerf" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.15}/>
                        <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                    </linearGradient>
                </defs>
                <CartesianGrid 
                    strokeDasharray="3 3" 
                    vertical={false} 
                    stroke="#e2e8f0" 
                    strokeOpacity={0.5}
                />
                <XAxis 
                    dataKey="label" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 9, fontWeight: 900, fill: '#94a3b8' }}
                    dy={10}
                />
                <YAxis hide domain={['dataMin - 100', 'dataMax + 100']} />
                <Tooltip 
                    contentStyle={{ 
                        borderRadius: '16px', 
                        border: 'none', 
                        fontWeight: 900, 
                        fontSize: '10px',
                        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                        textTransform: 'uppercase'
                    }} 
                />
                <Area 
                    type="monotone" 
                    dataKey="amount" 
                    stroke="#3B82F6" 
                    strokeWidth={4} 
                    fillOpacity={1} 
                    fill="url(#colorPerf)" 
                    animationDuration={1500}
                />
            </AreaChart>
        </ResponsiveContainer>
    );
}
