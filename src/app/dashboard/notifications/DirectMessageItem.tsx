
'use client';

import type { DirectMessage } from '@/lib/definitions';
import { useFirestore } from '@/firebase';
import { useRouter } from 'next/navigation';
import { doc, updateDoc } from 'firebase/firestore';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { User, MessageSquare, ArrowRight } from 'lucide-react';

export function DirectMessageItem({ message }: { message: DirectMessage }) {
  const firestore = useFirestore();
  const router = useRouter();

  const handleMessageClick = () => {
    if (!firestore || !message.userId || !message.id) return;
    if (!message.isRead) {
        const msgRef = doc(firestore, `users/${message.userId}/directMessages`, message.id);
        updateDoc(msgRef, { isRead: true }).catch(() => {});
    }
  };

  const timeAgo = message.createdAt?.toDate 
    ? formatDistanceToNow(message.createdAt.toDate(), { addSuffix: true, locale: es }) 
    : '...';

  return (
    <div
      onClick={handleMessageClick}
      className={cn(
        'group flex cursor-pointer items-start gap-5 p-6 transition-all duration-300 rounded-[2rem] border border-white shadow-sm hover:shadow-xl hover:-translate-y-0.5 active:scale-[0.99] relative overflow-hidden',
        !message.isRead ? 'bg-white ring-1 ring-primary/5' : 'bg-slate-50/50 opacity-80'
      )}
    >
      <div className="relative shrink-0">
        <Avatar className="h-14 w-14 border-2 border-primary/10 shadow-lg group-hover:scale-105 transition-transform duration-500">
            <AvatarImage src={message.senderAvatarUrl} alt={message.senderName} className="object-cover" />
            <AvatarFallback className="bg-primary/10 text-primary font-black"><User className="h-6 w-6" /></AvatarFallback>
        </Avatar>
        {!message.isRead && (
            <div className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary border-4 border-white shadow-lg animate-pulse" />
        )}
      </div>

      <div className='flex-1 min-w-0 space-y-1'>
        <div className="flex items-center justify-between gap-4">
            <p className="text-[10px] font-black uppercase text-primary tracking-[0.2em] flex items-center gap-2">
                <MessageSquare className="h-3 w-3" /> Chat de Soporte
            </p>
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest shrink-0">{timeAgo.toUpperCase()}</p>
        </div>
        <div className="space-y-0.5">
            <h3 className="text-[15px] font-black uppercase tracking-tighter text-slate-900 leading-tight">
                {message.senderName}
            </h3>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest truncate">{message.subject}</p>
        </div>
        <p className="text-[13px] text-slate-500 font-medium line-clamp-2 leading-relaxed mt-2">
          {message.body}
        </p>
      </div>

      <div className="absolute right-6 bottom-6 opacity-0 group-hover:opacity-100 transition-all translate-x-4 group-hover:translate-x-0">
          <ArrowRight className="h-5 w-5 text-primary" />
      </div>
    </div>
  );
}
