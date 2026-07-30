
'use client';

import type { SentMessage } from '@/lib/definitions';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Send,
  Users,
  ArrowRight
} from 'lucide-react';
import React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

export function SentMessageItem({ message }: { message: SentMessage }) {
  const timeAgo = message.createdAt?.toDate 
    ? formatDistanceToNow(message.createdAt.toDate(), { addSuffix: true, locale: es }) 
    : '...';

  return (
    <div
      className={cn(
        'group flex items-start gap-5 p-6 transition-all duration-300 rounded-[2rem] border border-white bg-white/50 shadow-sm hover:shadow-xl hover:-translate-y-0.5 relative overflow-hidden'
      )}
    >
      <div className="h-12 w-12 shrink-0 rounded-2xl border bg-slate-900 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-500">
        <Send className="h-5 w-5" />
      </div>

      <div className='flex-1 min-w-0 space-y-1'>
        <div className="flex items-center justify-between gap-4">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em]">Registro de Salida</p>
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest shrink-0">{timeAgo.toUpperCase()}</p>
        </div>
        <h3 className="text-[15px] font-black uppercase tracking-tighter text-slate-900 leading-tight">
            {message.subject}
        </h3>
        <p className="text-[13px] text-slate-500 font-medium line-clamp-2 leading-relaxed">
          {message.body}
        </p>
        {message.recipientSummary && (
            <div className="flex items-center gap-2 pt-2">
                <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 text-[8px] font-black uppercase px-2 h-5">
                    <Users className="h-2.5 w-2.5 mr-1.5" /> Enviado a: {message.recipientSummary}
                </Badge>
            </div>
        )}
      </div>
    </div>
  );
}
