'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useStorage } from '@/firebase';
import { uploadLargeFileToStorage } from '@/lib/large-file-upload';
import { authFetch } from '@/lib/auth-fetch';
import { useToast } from '@/hooks/use-toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Bot,
  Send,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Upload,
  X,
  Flame,
  PowerOff,
  Smartphone,
} from 'lucide-react';
import type { ActivePromotion } from '@/lib/active-promotions';

interface CommanderDraftUI {
  draftId: string;
  mode: 'resend_campaign' | 'new_promo';
  title: string;
  message: string;
  audienceType: 'all' | 'vips' | 'inactive' | 'debtors';
  recipientCount: number;
  mediaType: 'none' | 'image' | 'video' | 'pdf';
  mediaUrl: string;
  mediaFileName?: string;
  missingLegacyMediaWarning: boolean;
  matchedCampaignTitle?: string;
  activateInArm: boolean;
  promoDiscountPct?: number;
  promoCategory?: string;
  promoSummary: string;
  promoExpiresAt?: string | null;
}

export function WhatsAppCommanderPanel({ onLaunched }: { onLaunched?: () => void }) {
  const storage = useStorage();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [instruction, setInstruction] = useState('');
  const [isPlanning, setIsPlanning] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);

  const [draft, setDraft] = useState<CommanderDraftUI | null>(null);
  const [activePromos, setActivePromos] = useState<ActivePromotion[]>([]);

  const loadPromos = async () => {
    try {
      const res = await authFetch('/api/marketing/commander');
      const data = await res.json();
      if (data?.success && Array.isArray(data.promotions)) {
        setActivePromos(data.promotions);
      }
    } catch {
      // silencioso
    }
  };

  useEffect(() => {
    void loadPromos();
  }, []);

  const handlePlan = async (customText?: string) => {
    const promptText = (customText ?? instruction).trim();
    if (!promptText) {
      toast({ variant: 'destructive', title: 'Escribe una orden', description: 'Indícale al agente qué promoción quieres buscar o crear.' });
      return;
    }
    setIsPlanning(true);
    try {
      const res = await authFetch('/api/marketing/commander', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'plan', instruction: promptText }),
      });
      const data = await res.json();
      if (data?.success && data.draft) {
        setDraft(data.draft);
        toast({
          title: 'Borrador listo para confirmar',
          description: data.draft.mode === 'resend_campaign'
            ? `Encontré "${data.draft.matchedCampaignTitle}"`
            : 'Promoción redactada con inventario en vivo.',
        });
      } else {
        toast({ variant: 'destructive', title: 'No se pudo preparar', description: data?.error || 'Error inesperado' });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error de conexión', description: e?.message || 'Error al planificar.' });
    } finally {
      setIsPlanning(false);
    }
  };

  const handleUploadMedia = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !storage || !draft) return;
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isPdf && !isVideo && !isImage) {
      toast({ variant: 'destructive', title: 'Archivo no válido', description: 'Sube imagen, video o PDF.' });
      return;
    }
    setIsUploading(true);
    setUploadPct(0);
    try {
      const uploaded = await uploadLargeFileToStorage({
        storage,
        folder: 'broadcast-media',
        file,
        onProgress: (p) => setUploadPct(p),
      });
      setDraft({
        ...draft,
        mediaUrl: uploaded.downloadUrl,
        mediaType: isPdf ? 'pdf' : isVideo ? 'video' : 'image',
        mediaFileName: file.name,
        missingLegacyMediaWarning: false,
      });
      toast({ title: 'Archivo listo en Storage', description: `${file.name} quedó guardado de forma permanente.` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error subiendo archivo', description: err?.message || 'Fallo de subida.' });
    } finally {
      setIsUploading(false);
      setUploadPct(0);
      e.target.value = '';
    }
  };

  const handleConfirm = async () => {
    if (!draft) return;
    setIsConfirming(true);
    try {
      const res = await authFetch('/api/marketing/commander', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm',
          draftId: draft.draftId,
          overrides: {
            title: draft.title,
            message: draft.message,
            audienceType: draft.audienceType,
            mediaType: draft.mediaType,
            mediaUrl: draft.mediaUrl,
            mediaFileName: draft.mediaFileName,
            activateInArm: draft.activateInArm,
            promoDiscountPct: draft.promoDiscountPct,
            promoCategory: draft.promoCategory,
            promoExpiresAt: draft.promoExpiresAt || null,
          },
        }),
      });
      const data = await res.json();
      if (data?.success) {
        toast({
          title: '🚀 Campaña lanzada por el Comandante',
          description: `Encolada para ${data.totalTarget} clientes${data.promoActivatedInArm ? ' y activada en el Agente ARM.' : '.'}`,
        });
        setDraft(null);
        setInstruction('');
        void loadPromos();
        if (onLaunched) onLaunched();
      } else {
        toast({ variant: 'destructive', title: 'Error al lanzar', description: data?.error || 'No se pudo enviar.' });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e?.message || 'Fallo al confirmar.' });
    } finally {
      setIsConfirming(false);
    }
  };

  const handleCancelDraft = async () => {
    if (!draft) return;
    const id = draft.draftId;
    setDraft(null);
    await authFetch('/api/marketing/commander', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel', draftId: id }),
    }).catch(() => {});
  };

  const handleDeactivatePromo = async (promoId: string) => {
    try {
      const res = await authFetch('/api/marketing/commander', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle_promo', promoId, active: false }),
      });
      const data = await res.json();
      if (data?.success) {
        setActivePromos(data.promotions || []);
        toast({ title: 'Promoción desactivada en ARM' });
      }
    } catch {}
  };

  return (
    <Card className="border-none shadow-xl rounded-[2.5rem] bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950 text-white p-6 sm:p-8 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center shrink-0">
            <Bot className="h-6 w-6 text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-black uppercase tracking-tight">Agente Comandante de Promociones</h3>
              <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-[9px] font-black uppercase">
                Web + WhatsApp SuperAdmin
              </Badge>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Pídele reenviar campañas pasadas (como la promo 40% en bicicletas) o crear una nueva, y actívala automáticamente en el Agente ARM.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-emerald-300 font-bold bg-white/5 px-3 py-1.5 rounded-xl border border-white/10 shrink-0">
          <Smartphone className="h-3.5 w-3.5" /> También activo desde tu WhatsApp SuperAdmin
        </div>
      </div>

      {/* Input de instrucción natural */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <Input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !isPlanning) void handlePlan(); }}
          placeholder="Ej: Envía de nuevo la promoción de las bicicletas con 40% pago de contado y divisas a todos los clientes"
          className="h-12 bg-white/10 border-white/20 text-white placeholder:text-slate-400 rounded-2xl text-xs font-medium flex-1"
        />
        <Button
          type="button"
          disabled={isPlanning || !instruction.trim()}
          onClick={() => handlePlan()}
          className="h-12 px-6 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black uppercase text-[11px] tracking-wider shrink-0"
        >
          {isPlanning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
          Preparar Campaña
        </Button>
      </div>

      {/* Sugerencias rápidas */}
      <div className="flex flex-wrap gap-2">
        {[
          'Reenvía la promoción de bicicletas con 40% contado y divisas a todos los clientes',
          'Crea una promo de balones deportivos para clientes inactivos',
        ].map((sample) => (
          <button
            key={sample}
            type="button"
            onClick={() => { setInstruction(sample); void handlePlan(sample); }}
            className="text-[10px] font-bold px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 text-slate-200 transition-colors cursor-pointer"
          >
            ✨ {sample}
          </button>
        ))}
      </div>

      {/* Borrador de confirmación */}
      {draft && (
        <div className="p-5 sm:p-6 rounded-3xl bg-white text-slate-900 space-y-4 shadow-2xl animate-in fade-in-50">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Badge className="bg-emerald-600 text-white border-none text-[9px] font-black uppercase">
                {draft.mode === 'resend_campaign' ? 'Campaña Encontrada en Historial' : 'Nueva Promoción Redactada'}
              </Badge>
              <Badge variant="outline" className="text-[10px] font-black">
                {draft.recipientCount} destinatarios
              </Badge>
            </div>
            <button type="button" onClick={handleCancelDraft} className="text-slate-400 hover:text-slate-700 p-1">
              <X className="h-4 w-4" />
            </button>
          </div>

          {draft.missingLegacyMediaWarning && (
            <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 text-amber-900 text-xs">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  La campaña original del 09/11 no guardó el archivo multimedia en Storage. Puedes enviar el texto tal cual o subir el video/foto aquí para dejarlo guardado para siempre.
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isUploading}
                onClick={() => fileRef.current?.click()}
                className="rounded-xl border-amber-300 bg-white text-amber-900 font-black uppercase text-[9px] shrink-0"
              >
                {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
                {isUploading ? `Subiendo ${uploadPct}%` : 'Subir Video / Foto'}
              </Button>
            </div>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*,.pdf"
            className="hidden"
            onChange={handleUploadMedia}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase text-slate-500">Título de la campaña</Label>
              <Input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className="h-10 rounded-xl font-bold text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase text-slate-500">Audiencia</Label>
              <Select
                value={draft.audienceType}
                onValueChange={(v) => setDraft({ ...draft, audienceType: v as CommanderDraftUI['audienceType'] })}
              >
                <SelectTrigger className="h-10 rounded-xl text-xs font-bold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los clientes</SelectItem>
                  <SelectItem value="vips">Clientes VIP</SelectItem>
                  <SelectItem value="inactive">Clientes inactivos (+30 días)</SelectItem>
                  <SelectItem value="debtors">Clientes con saldo pendiente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] font-black uppercase text-slate-500">Mensaje de WhatsApp</Label>
              {draft.mediaUrl && (
                <Badge variant="secondary" className="text-[9px] font-bold">
                  Adjunto listo: {draft.mediaType.toUpperCase()} {draft.mediaFileName ? `(${draft.mediaFileName})` : ''}
                </Badge>
              )}
              {!draft.mediaUrl && !draft.missingLegacyMediaWarning && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="text-[10px] font-black uppercase text-blue-600 hover:underline cursor-pointer"
                >
                  + Adjuntar video / foto / PDF
                </button>
              )}
            </div>
            <Textarea
              rows={5}
              value={draft.message}
              onChange={(e) => setDraft({ ...draft, message: e.target.value })}
              className="rounded-xl text-xs font-medium"
            />
          </div>

          {/* Activación automática en el Agente ARM */}
          <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Switch
                  id="cmd-arm-promo"
                  checked={draft.activateInArm}
                  onCheckedChange={(v) => setDraft({ ...draft, activateInArm: v })}
                />
                <Label htmlFor="cmd-arm-promo" className="text-xs font-black text-emerald-950 cursor-pointer">
                  Activar esta promoción en el Agente ARM (responderá con este descuento cuando los clientes pregunten)
                </Label>
              </div>
            </div>
            {draft.activateInArm && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <Label className="text-[9px] font-black uppercase text-emerald-800">% Descuento Promo</Label>
                  <Input
                    type="number"
                    min={1}
                    max={90}
                    value={draft.promoDiscountPct ?? ''}
                    placeholder="Ej: 40"
                    onChange={(e) => setDraft({ ...draft, promoDiscountPct: e.target.value ? Number(e.target.value) : undefined })}
                    className="h-9 bg-white rounded-xl text-xs font-bold"
                  />
                </div>
                <div>
                  <Label className="text-[9px] font-black uppercase text-emerald-800">Línea / Categoría</Label>
                  <Input
                    value={draft.promoCategory ?? ''}
                    placeholder="Ej: BICICLETAS"
                    onChange={(e) => setDraft({ ...draft, promoCategory: e.target.value })}
                    className="h-9 bg-white rounded-xl text-xs font-bold uppercase"
                  />
                </div>
                <div>
                  <Label className="text-[9px] font-black uppercase text-emerald-800">Vence (Opcional)</Label>
                  <Input
                    type="date"
                    value={draft.promoExpiresAt ? draft.promoExpiresAt.slice(0, 10) : ''}
                    onChange={(e) => setDraft({ ...draft, promoExpiresAt: e.target.value ? `${e.target.value}T23:59:59` : null })}
                    className="h-9 bg-white rounded-xl text-xs font-bold"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={handleCancelDraft} className="rounded-xl text-xs font-bold">
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={isConfirming || !draft.title.trim() || !draft.message.trim()}
              onClick={handleConfirm}
              className="h-11 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase text-xs tracking-wider shadow-lg"
            >
              {isConfirming ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Confirmar y Enviar Campaña
            </Button>
          </div>
        </div>
      )}

      {/* Promociones activas actualmente en ARM */}
      {activePromos.length > 0 && (
        <div className="pt-2 border-t border-white/10 space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-300 flex items-center gap-1.5">
            <Flame className="h-3.5 w-3.5" /> Promociones Activas en el Agente ARM ({activePromos.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {activePromos.map((p) => (
              <div key={p.id} className="flex items-center gap-2 bg-white/10 border border-white/15 px-3 py-1.5 rounded-xl text-xs">
                <span className="font-bold text-white">{p.title}</span>
                {p.discountPct ? <Badge className="bg-emerald-500 text-slate-950 text-[9px] font-black">-{p.discountPct}%</Badge> : null}
                <button
                  type="button"
                  onClick={() => handleDeactivatePromo(p.id)}
                  title="Desactivar promoción en ARM"
                  className="text-rose-300 hover:text-rose-100 ml-1 cursor-pointer"
                >
                  <PowerOff className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
