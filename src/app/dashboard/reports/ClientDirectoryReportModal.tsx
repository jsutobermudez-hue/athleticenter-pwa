'use client';

import React, { useState, useMemo } from 'react';
import type { Customer, User as AppUser } from '@/lib/definitions';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Phone,
  Printer,
  Search,
  Download,
  Copy,
  Check,
  MessageCircle,
  Building2,
  User,
  MapPin,
  ExternalLink,
  ShieldCheck,
  Filter,
  Users
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface ClientDirectoryReportModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  customers: Customer[];
  salespeople?: AppUser[];
}

export function ClientDirectoryReportModal({
  isOpen,
  onOpenChange,
  customers = [],
  salespeople = []
}: ClientDirectoryReportModalProps) {
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<'general' | 'individual'>('general');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSalesperson, setSelectedSalesperson] = useState('all');
  const [selectedCity, setSelectedCity] = useState('all');
  const [selectedIndividualId, setSelectedIndividualId] = useState<string>(customers[0]?.id || '');
  const [copiedPhones, setCopiedPhones] = useState(false);

  // Vendedores únicos
  const availableSalespeople = useMemo(() => {
    const set = new Set<string>();
    customers.forEach(c => {
      const sp = (c as any).salesperson || (c as any).vendedor || (c as any).salespersonName;
      if (sp) set.add(String(sp).trim());
    });
    return Array.from(set).sort();
  }, [customers]);

  // Ciudades únicas
  const availableCities = useMemo(() => {
    const set = new Set<string>();
    customers.forEach(c => {
      const city = (c as any).city || (c as any).ciudad;
      if (city) set.add(String(city).trim());
    });
    return Array.from(set).sort();
  }, [customers]);

  // Normalizador de teléfono a formato internacional +58
  const normalizePhone = (raw: string) => {
    let clean = String(raw || '').replace(/\D/g, '');
    if (clean.startsWith('0')) clean = '58' + clean.substring(1);
    if (!clean.startsWith('58') && clean.length === 10) clean = '58' + clean;
    return clean;
  };

  // Filtrado de clientes para la tabla general
  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      const name = (c.razonSocial || (c as any).nombre || '').toLowerCase();
      const rif = (c.rif || '').toLowerCase();
      const phone = (c.phone || (c as any).whatsappPhone || (c as any).telefono || '').toLowerCase();
      const contact = ((c as any).contactPerson || (c as any).contacto || '').toLowerCase();
      const sp = String((c as any).salesperson || (c as any).vendedor || '').toLowerCase();
      const city = String((c as any).city || (c as any).ciudad || '').toLowerCase();

      const matchesSearch = !searchTerm.trim() || 
        name.includes(searchTerm.toLowerCase()) || 
        rif.includes(searchTerm.toLowerCase()) || 
        phone.includes(searchTerm.toLowerCase()) || 
        contact.includes(searchTerm.toLowerCase());

      const matchesSp = selectedSalesperson === 'all' || sp === selectedSalesperson.toLowerCase();
      const matchesCity = selectedCity === 'all' || city === selectedCity.toLowerCase();

      return matchesSearch && matchesSp && matchesCity;
    });
  }, [customers, searchTerm, selectedSalesperson, selectedCity]);

  // Cliente individual seleccionado
  const individualClient = useMemo(() => {
    return customers.find(c => c.id === selectedIndividualId) || customers[0] || null;
  }, [customers, selectedIndividualId]);

  // Copiar teléfonos al portapapeles
  const handleCopyPhones = () => {
    const phones = filteredCustomers
      .map(c => normalizePhone(c.phone || (c as any).whatsappPhone || (c as any).telefono || ''))
      .filter(p => p.length >= 10);

    if (phones.length === 0) {
      toast({ variant: 'destructive', title: 'Sin teléfonos', description: 'No hay teléfonos válidos en la lista actual.' });
      return;
    }

    const textToCopy = Array.from(new Set(phones)).join(', ');
    navigator.clipboard.writeText(textToCopy);
    setCopiedPhones(true);
    setTimeout(() => setCopiedPhones(false), 3000);
    toast({
      title: '📋 ¡Teléfonos Copiados!',
      description: `Se copiaron ${phones.length} números en formato internacional (+58...).`
    });
  };

  // Exportar Directorio a CSV / Excel
  const handleExportCSV = () => {
    if (filteredCustomers.length === 0) {
      toast({ variant: 'destructive', title: 'Sin clientes para exportar' });
      return;
    }

    const headers = ['#', 'Razón Social', 'RIF', 'Persona de Contacto', 'Teléfono Móvil / WhatsApp', 'Email', 'Ciudad / Estado', 'Dirección', 'Asesor Comercial', 'Saldo Deudor USD'];
    const rows = filteredCustomers.map((c, idx) => {
      const balance = Number((c as any).balanceUSD || (c as any).currentBalanceUSD || (c as any).saldoPendienteUSD || 0);
      return [
        idx + 1,
        `"${(c.razonSocial || (c as any).nombre || 'Cliente').replace(/"/g, '""')}"`,
        `"${(c.rif || 'N/A').replace(/"/g, '""')}"`,
        `"${((c as any).contactPerson || (c as any).contacto || 'Encargado').replace(/"/g, '""')}"`,
        `"${normalizePhone(c.phone || (c as any).whatsappPhone || (c as any).telefono || '')}"`,
        `"${(c.email || 'N/A').replace(/"/g, '""')}"`,
        `"${((c as any).city || 'Caracas').replace(/"/g, '""')}"`,
        `"${(c.address || (c as any).direccion || 'N/A').replace(/"/g, '""')}"`,
        `"${((c as any).salesperson || (c as any).vendedor || 'Venta Directa').replace(/"/g, '""')}"`,
        balance.toFixed(2)
      ];
    });

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Directorio_Clientes_Athleticenter_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: '📊 ¡Directorio Telefónico Exportado a CSV/Excel!' });
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-5xl p-0 overflow-hidden rounded-[2.5rem] border-none shadow-2xl flex flex-col max-h-[94vh]">
        {/* CABECERA (NO SE IMPRIME) */}
        <DialogHeader className="p-6 bg-slate-900 text-white shrink-0 print:hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-emerald-500/20 text-emerald-400 shrink-0">
                <Phone className="h-6 w-6" />
              </div>
              <div>
                <DialogTitle className="text-xl font-black uppercase text-white flex items-center gap-2">
                  Directorio Telefónico & Comercial de Clientes
                  <Badge className="bg-emerald-500/20 text-emerald-400 border-none text-[8px] font-black uppercase">
                    Ventas & Cobranza
                  </Badge>
                </DialogTitle>
                <DialogDescription className="text-slate-400 text-xs">
                  Consulta de contactos comerciales con números de WhatsApp, exportación a Excel e impresión ejecutiva.
                </DialogDescription>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyPhones}
                className="h-9 px-3 rounded-xl border-slate-700 bg-slate-800 text-slate-200 hover:text-white text-[10px] font-black uppercase"
              >
                {copiedPhones ? <Check className="h-3.5 w-3.5 mr-1 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                Copiar Teléfonos
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleExportCSV}
                className="h-9 px-3 rounded-xl border-slate-700 bg-slate-800 text-slate-200 hover:text-white text-[10px] font-black uppercase"
              >
                <Download className="h-3.5 w-3.5 mr-1" /> Excel / CSV
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handlePrint}
                className="h-9 px-4 rounded-xl bg-primary hover:bg-primary/90 text-white text-[10px] font-black uppercase flex items-center gap-1.5"
              >
                <Printer className="h-3.5 w-3.5" /> Imprimir Directorio
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* SELECTOR DE PESTAÑAS */}
        <div className="p-4 sm:p-6 bg-slate-50 border-b border-slate-200/80 shrink-0 print:hidden">
          <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as any)} className="w-full">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <TabsList className="bg-slate-200/80 p-1 rounded-2xl w-full sm:w-auto">
                <TabsTrigger value="general" className="rounded-xl text-[10px] font-black uppercase">
                  <Users className="h-3.5 w-3.5 mr-1.5" /> Directorio Consolidado ({filteredCustomers.length})
                </TabsTrigger>
                <TabsTrigger value="individual" className="rounded-xl text-[10px] font-black uppercase">
                  <User className="h-3.5 w-3.5 mr-1.5" /> Ficha de Contacto Individual
                </TabsTrigger>
              </TabsList>

              {activeTab === 'general' ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative w-full sm:w-48">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    <Input
                      placeholder="Buscar cliente..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="h-8 pl-8 rounded-xl text-xs bg-white"
                    />
                  </div>
                  <select
                    className="h-8 px-2 rounded-xl bg-white border border-slate-200 text-[10px] font-bold uppercase"
                    value={selectedSalesperson}
                    onChange={(e) => setSelectedSalesperson(e.target.value)}
                  >
                    <option value="all">Todos los Vendedores</option>
                    {availableSalespeople.map(sp => (
                      <option key={sp} value={sp}>{sp}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <select
                  className="h-9 px-3 rounded-xl bg-white border border-slate-300 text-xs font-bold uppercase w-full sm:w-72"
                  value={selectedIndividualId}
                  onChange={(e) => setSelectedIndividualId(e.target.value)}
                >
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.razonSocial || (c as any).nombre} ({c.phone || 'S/T'})
                    </option>
                  ))}
                </select>
              )}
            </div>
          </Tabs>
        </div>

        {/* CONTENIDO DEL REPORTE */}
        <div className="p-6 overflow-y-auto flex-1 bg-white print:p-0 print:overflow-visible">
          {/* VISTA 1: DIRECTORIO CONSOLIDADO */}
          {activeTab === 'general' && (
            <div className="space-y-4">
              {/* Encabezado para Impresión */}
              <div className="hidden print:block border-b-2 border-slate-900 pb-3 mb-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-black uppercase text-slate-900">ATHLETICENTER · DIRECTORIO COMERCIAL</h2>
                    <p className="text-[10px] text-slate-500 font-bold uppercase">Listado de Clientes y Teléfonos de Contacto</p>
                  </div>
                  <p className="text-[10px] font-mono text-slate-500">
                    {format(new Date(), "dd/MM/yyyy HH:mm")} · {filteredCustomers.length} Clientes
                  </p>
                </div>
              </div>

              {filteredCustomers.length === 0 ? (
                <div className="p-12 text-center text-slate-400 font-bold uppercase text-xs">
                  No se encontraron clientes con los filtros aplicados.
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-100 text-[9px] font-black uppercase text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="p-3 pl-4">#</th>
                        <th className="p-3">Razón Social</th>
                        <th className="p-3">RIF</th>
                        <th className="p-3">Contacto</th>
                        <th className="p-3">Teléfono WhatsApp</th>
                        <th className="p-3">Ciudad</th>
                        <th className="p-3">Asesor</th>
                        <th className="p-3 pr-4 text-center print:hidden">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {filteredCustomers.map((c, idx) => {
                        const rawPhone = c.phone || (c as any).whatsappPhone || (c as any).telefono || '';
                        const cleanPhone = normalizePhone(rawPhone);
                        const hasValidPhone = cleanPhone.length >= 10;

                        return (
                          <tr key={c.id || idx} className="hover:bg-slate-50 transition-colors">
                            <td className="p-3 pl-4 font-mono text-slate-400 text-[10px]">{idx + 1}</td>
                            <td className="p-3 font-black text-slate-900 uppercase">
                              {c.razonSocial || (c as any).nombre}
                            </td>
                            <td className="p-3 font-mono text-slate-500">{c.rif || 'N/A'}</td>
                            <td className="p-3 text-slate-700">{(c as any).contactPerson || (c as any).contacto || 'Encargado'}</td>
                            <td className="p-3 font-mono font-bold text-slate-900">
                              {rawPhone ? (
                                <span className="flex items-center gap-1">
                                  <Phone className="h-3 w-3 text-emerald-600 shrink-0" />
                                  +{cleanPhone}
                                </span>
                              ) : (
                                <span className="text-slate-400 text-[10px] italic">Sin teléfono</span>
                              )}
                            </td>
                            <td className="p-3 text-slate-600">{(c as any).city || 'Caracas'}</td>
                            <td className="p-3">
                              <Badge variant="outline" className="text-[8px] font-black uppercase border-slate-200">
                                {(c as any).salesperson || (c as any).vendedor || 'Venta Directa'}
                              </Badge>
                            </td>
                            <td className="p-3 pr-4 text-center print:hidden">
                              {hasValidPhone && (
                                <a
                                  href={`https://wa.me/${cleanPhone}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center justify-center h-7 px-2.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-[9px] font-black uppercase transition-colors"
                                  title="Abrir WhatsApp"
                                >
                                  <MessageCircle className="h-3 w-3 mr-1" /> WhatsApp
                                </a>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* VISTA 2: FICHA DE CONTACTO INDIVIDUAL */}
          {activeTab === 'individual' && individualClient && (
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="p-6 rounded-3xl bg-slate-50 border border-slate-200 space-y-4 shadow-sm print:bg-white print:border-slate-300">
                <div className="flex justify-between items-start border-b border-slate-200 pb-4">
                  <div>
                    <h3 className="text-xl font-black uppercase text-slate-900 leading-tight">
                      {individualClient.razonSocial || (individualClient as any).nombre}
                    </h3>
                    <p className="text-xs font-mono font-bold text-slate-500 mt-0.5">
                      RIF: {individualClient.rif || 'Sin RIF'} · Cliente Athleticenter
                    </p>
                  </div>
                  <Badge className="bg-primary text-white text-[9px] font-black uppercase px-2.5 py-1">
                    Contacto Directo
                  </Badge>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="p-3 bg-white rounded-xl border border-slate-200">
                    <span className="text-[9px] font-black uppercase text-slate-400 block">Persona de Contacto</span>
                    <p className="font-bold text-slate-800 text-sm mt-0.5">
                      {(individualClient as any).contactPerson || (individualClient as any).contacto || 'Encargado de Tienda'}
                    </p>
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-slate-200">
                    <span className="text-[9px] font-black uppercase text-slate-400 block">Asesor Asignado</span>
                    <p className="font-bold text-primary text-sm mt-0.5">
                      {(individualClient as any).salesperson || (individualClient as any).vendedor || 'Venta Directa'}
                    </p>
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-slate-200 sm:col-span-2">
                    <span className="text-[9px] font-black uppercase text-slate-400 block">Teléfono Principal WhatsApp</span>
                    <p className="font-mono font-black text-slate-900 text-base mt-1 flex items-center gap-1.5">
                      <Phone className="h-4 w-4 text-emerald-600" />
                      +{normalizePhone(individualClient.phone || (individualClient as any).whatsappPhone || (individualClient as any).telefono || '')}
                    </p>
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-slate-200 sm:col-span-2">
                    <span className="text-[9px] font-black uppercase text-slate-400 block">Ubicación y Dirección</span>
                    <p className="font-medium text-slate-700 mt-0.5 flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      {individualClient.address || (individualClient as any).direccion || 'Caracas'}, {(individualClient as any).city || 'Distrito Capital'}
                    </p>
                  </div>
                </div>

                {/* Botones de Acción Inmediata */}
                <div className="pt-2 flex flex-wrap gap-2.5 print:hidden">
                  {individualClient.phone && (
                    <a
                      href={`https://wa.me/${normalizePhone(individualClient.phone || (individualClient as any).whatsappPhone || '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 min-w-[140px] h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase flex items-center justify-center gap-2 shadow-md transition-all"
                    >
                      <MessageCircle className="h-4 w-4" /> Chatear en WhatsApp
                    </a>
                  )}
                  {individualClient.phone && (
                    <a
                      href={`tel:+${normalizePhone(individualClient.phone || (individualClient as any).whatsappPhone || '')}`}
                      className="h-11 px-5 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-800 font-black text-xs uppercase flex items-center justify-center gap-2"
                    >
                      <Phone className="h-4 w-4" /> Llamar
                    </a>
                  )}
                  <Button
                    type="button"
                    onClick={handlePrint}
                    variant="outline"
                    className="h-11 px-5 rounded-xl border-slate-300 hover:bg-slate-100 text-slate-800 font-black text-xs uppercase flex items-center justify-center gap-2"
                  >
                    <Printer className="h-4 w-4" /> Imprimir Tarjeta
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* PIE DEL DIÁLOGO (NO SE IMPRIME) */}
        <DialogFooter className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between shrink-0 print:hidden">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-xl font-black uppercase text-[10px]"
          >
            Cerrar
          </Button>
          <Button
            type="button"
            onClick={handlePrint}
            className="h-11 px-6 rounded-xl bg-slate-900 hover:bg-primary text-white font-black uppercase text-xs flex items-center gap-1.5"
          >
            <Printer className="h-4 w-4" /> Imprimir Vista Actual
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
