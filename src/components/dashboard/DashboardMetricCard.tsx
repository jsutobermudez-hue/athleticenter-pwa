'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowUpRight, X, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface MetricCardProps {
    title: string;
    value: string | number;
    subtitle?: string;
    icon: React.ElementType;
    iconBg?: string;
    iconColor?: string;
    onClick?: () => void;
    onIconClick?: (e: React.MouseEvent) => void;
    alert?: boolean;
    isLoading?: boolean;
    trend?: string;
    isActive?: boolean;
    tooltip?: string;
}

/**
 * COMPONENTE ÚNICO DE MÉTRICAS v1.1
 * Con soporte para Tooltips explicativos en Hover.
 */
export function DashboardMetricCard({ 
    title, value, subtitle, icon: Icon, iconBg, iconColor, 
    onClick, onIconClick, alert = false, isLoading = false, trend, isActive = false, tooltip 
}: MetricCardProps) {
    const content = (
        <Card 
            className={cn(
                "border-none shadow-xl rounded-[2rem] bg-white group transition-all relative overflow-hidden",
                onClick && "cursor-pointer hover:shadow-2xl hover:-translate-y-1 active:scale-95",
                alert && !isActive && "ring-2 ring-rose-500/20",
                isActive && "ring-2 ring-primary bg-primary/5 shadow-lg"
            )}
            onClick={onClick}
        >
            <CardContent className="p-8">
                <div className="flex justify-between items-start">
                    <div className="space-y-2 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className={cn("text-[10px] font-black uppercase tracking-[0.2em]", isActive ? "text-primary" : "text-slate-400")}>{title}</p>
                          {tooltip && <Info className="h-3 w-3 text-slate-300 group-hover:text-primary transition-colors" />}
                        </div>
                        {isLoading ? (
                            <Skeleton className="h-8 w-24 rounded-lg bg-slate-100" />
                        ) : (
                            <div className="space-y-1">
                                <h3 className={cn("text-3xl font-black tracking-tighter leading-none", alert && !isActive ? "text-rose-600" : "text-slate-900", isActive && "text-primary")}>{value}</h3>
                                {trend && <p className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest">{trend}</p>}
                            </div>
                        )}
                        {subtitle && <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">{subtitle}</p>}
                    </div>
                    <div 
                        onClick={(e) => {
                            if (onIconClick) {
                                e.stopPropagation();
                                onIconClick(e);
                            }
                        }}
                        className={cn(
                            "p-4 rounded-2xl shadow-sm transition-transform group-hover:rotate-12", 
                            isActive ? "bg-primary text-white" : cn(iconBg, iconColor),
                            onIconClick && "cursor-pointer hover:scale-110 active:scale-95 shadow-md"
                        )}
                        title={onIconClick ? "Abrir Auditoría Táctica In-Situ" : undefined}
                    >
                        {isActive ? <X className="h-6 w-6" /> : (Icon && <Icon className="h-6 w-6" />)}
                    </div>
                </div>
                {onClick && !isActive && (
                    <div className="absolute bottom-4 right-8 opacity-0 group-hover:opacity-100 transition-opacity">
                        <ArrowUpRight className="h-4 w-4 text-slate-300" />
                    </div>
                )}
            </CardContent>
        </Card>
    );

    if (!tooltip) return content;

    return (
        <TooltipProvider delayDuration={150}>
            <Tooltip>
                <TooltipTrigger asChild>
                    {content}
                </TooltipTrigger>
                <TooltipContent 
                    side="top" 
                    className="bg-slate-900 text-white font-mono text-[10px] font-black max-w-xs p-3 rounded-xl border-none shadow-2xl space-y-1"
                >
                    <p className="font-bold tracking-tight text-white leading-snug">💡 {tooltip}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}
