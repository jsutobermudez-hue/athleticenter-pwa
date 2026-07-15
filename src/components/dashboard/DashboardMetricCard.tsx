'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowUpRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MetricCardProps {
    title: string;
    value: string | number;
    subtitle?: string;
    icon: React.ElementType;
    iconBg?: string;
    iconColor?: string;
    onClick?: () => void;
    alert?: boolean;
    isLoading?: boolean;
    trend?: string;
    isActive?: boolean;
}

/**
 * COMPONENTE ÚNICO DE MÉTRICAS v1.0
 * Unificado para evitar errores de duplicación durante la publicación.
 */
export function DashboardMetricCard({ 
    title, value, subtitle, icon: Icon, iconBg, iconColor, 
    onClick, alert = false, isLoading = false, trend, isActive = false 
}: MetricCardProps) {
    return (
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
                        <p className={cn("text-[10px] font-black uppercase tracking-[0.2em]", isActive ? "text-primary" : "text-slate-400")}>{title}</p>
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
                    <div className={cn(
                        "p-4 rounded-2xl shadow-sm transition-transform group-hover:rotate-12", 
                        isActive ? "bg-primary text-white" : cn(iconBg, iconColor)
                    )}>
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
}
