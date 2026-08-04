'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Target, Wallet, Award } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SalesGoalWidgetProps {
  commissionValue: number;
  goalValue?: number;
  isLoading?: boolean;
}

export function SalesGoalWidget({ commissionValue, goalValue = 500, isLoading = false }: SalesGoalWidgetProps) {
  const percentage = Math.min(Math.round((commissionValue / goalValue) * 100), 100);
  
  // Parámetros de arco SVG
  const radius = 50;
  const strokeWidth = 10;
  const normalizedRadius = radius - strokeWidth * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  if (isLoading) {
    return (
      <Card className="border border-white/5 shadow-2xl rounded-[2.5rem] bg-slate-900 text-white p-8">
        <div className="h-44 w-full flex items-center justify-center animate-pulse">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Cargando Meta...</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border border-white/10 shadow-2xl rounded-[2.5rem] bg-slate-900 text-white relative overflow-hidden group">
      <div className="absolute top-0 right-0 p-6 opacity-[0.03] group-hover:rotate-12 transition-transform duration-1000">
        <Award className="h-32 w-32" />
      </div>
      <CardContent className="p-8 space-y-6">
        <div className="space-y-1">
          <h3 className="text-xs font-black uppercase tracking-[0.3em] text-primary flex items-center gap-3">
            <Target className="h-5 w-5" /> Meta Comercial
          </h3>
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Rendimiento de Comisiones del Mes</p>
        </div>

        <div className="flex items-center justify-between gap-6">
          {/* Anillo de Progreso SVG */}
          <div className="relative flex items-center justify-center h-28 w-28 flex-shrink-0">
            <svg className="transform -rotate-95 h-28 w-28">
              {/* Fondo del círculo */}
              <circle
                stroke="rgba(255,255,255,0.05)"
                fill="transparent"
                strokeWidth={strokeWidth}
                r={normalizedRadius}
                cx="56"
                cy="56"
              />
              {/* Relleno de neón con degradado */}
              <circle
                stroke="#3b82f6"
                fill="transparent"
                strokeWidth={strokeWidth}
                strokeDasharray={circumference + ' ' + circumference}
                style={{ strokeDashoffset, transition: 'stroke-dashoffset 0.8s ease-in-out' }}
                strokeLinecap="round"
                r={normalizedRadius}
                cx="56"
                cy="56"
              />
            </svg>
            <div className="absolute flex flex-col items-center justify-center">
              <span className="text-2xl font-black tracking-tighter">{percentage}%</span>
              <span className="text-[7px] font-black uppercase text-slate-500 tracking-wider">Logrado</span>
            </div>
          </div>

          {/* Métricas detalladas */}
          <div className="space-y-4 flex-1">
            <div className="space-y-0.5">
              <span className="text-[8px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                <Wallet className="h-3 w-3 text-emerald-500" /> Acumulado
              </span>
              <p className="text-lg font-black tracking-tight text-white">${commissionValue.toFixed(2)}</p>
            </div>
            <div className="space-y-0.5">
              <span className="text-[8px] font-black uppercase tracking-widest text-slate-500">Objetivo Mensual</span>
              <p className="text-sm font-black tracking-tight text-slate-300">${goalValue.toFixed(2)}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
