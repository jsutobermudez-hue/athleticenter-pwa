
'use client';

import type { DirectMessage } from '@/lib/definitions';
import { useFirestore } from '@/firebase';
import { useRouter } from 'next/navigation';
import { doc, updateDoc } from 'firebase/firestore';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { User, MessageSquare, ArrowRight, Reply } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function DirectMessageItem({ 
  message, 
  onOpenThread 
}: { 
  message: DirectMessage; 
  onOpenThread?: (message: DirectMessage) => void;
}) {
  const firestore = useFirestore();
  const router = useRouter();

  const handleMessageClick = () => {
    if (firestore && message.userId && message.id && !message.isRead) {
        const msgRef = doc(firestore, `users/${message.userId}/directMessages`, message.id);
        updateDoc(msgRef, { isRead: true }).catch(() => {});
    }
    if (onOpenThread) {
        onOpenThread(message);
    }
  };

  const timeAgo = message.createdAt?.toDate 
    ? formatDistanceToNow(message.createdAt.toDate(), { addSuffix: true, locale: es }) 
    : '...';

  return (
    <div
      onClick={handleMessageClick}
      className={cn(
        'group flex flex-col sm:flex-row sm:items-start gap-5 p-6 transition-all duration-300 rounded-[2rem] border border-white shadow-sm hover:shadow-xl hover:-translate-y-0.5 active:scale-[0.99] relative overflow-hidden',
        !message.isRead ? 'bg-white ring-1 ring-primary/5' : 'bg-slate-50/50 opacity-80'
      )}
    >
      <div className="flex items-start gap-4 flex-1 min-w-0">
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
      </div>

      <div className="flex items-center justify-end sm:justify-center shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
        <Button
          size="sm"
          className="h-10 px-5 rounded-xl font-black text-[9px] uppercase tracking-widest bg-primary/10 text-primary hover:bg-primary hover:text-white transition-all shadow-sm group-hover:shadow-md flex items-center gap-2"
          onClick={(e) => {
            e.stopPropagation();
            handleMessageClick();
          }}
        >
          <Reply className="h-3.5 w-3.5" /> Responder
        </Button>
      </div>
    </div>
  );
}
