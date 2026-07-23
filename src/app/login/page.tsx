'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { useAuth, useUser } from '@/firebase/index';
import { 
    signInWithEmailAndPassword, 
    setPersistence, 
    browserLocalPersistence, 
    browserSessionPersistence 
} from 'firebase/auth';
import { Loader2, Eye, EyeOff, User as UserIcon, Lock, LogIn } from 'lucide-react';
import { DynamicAppLogo } from '@/components/icons/dynamic-app-logo';

const loginSchema = z.object({
  email: z.string().email('Email inválido.'),
  password: z.string().min(1, 'Contraseña requerida.'),
  rememberMe: z.boolean().default(true),
});

/**
 * PÁGINA DE LOGIN v11.2 - REUBICACIÓN DE PERSISTENCIA
 * Saneado: Casilla de sesión iniciada movida después de recuperación de clave.
 */
function LoginPageContent() {
  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
        rememberMe: true
    }
  });

  const [showPassword, setShowPassword] = useState(false);
  const { toast } = useToast();
  const auth = useAuth();
  const router = useRouter();
  const { user, profile, isUserLoading } = useUser();

  useEffect(() => {
    if (!isUserLoading && user && profile) {
        router.replace('/dashboard');
    }
  }, [user, profile, isUserLoading, router]);

  const onSubmit = async (data: z.infer<typeof loginSchema>) => {
    if (!auth) return;
    try {
      const persistence = data.rememberMe ? browserLocalPersistence : browserSessionPersistence;
      await setPersistence(auth, persistence);
      
      await signInWithEmailAndPassword(auth, data.email, data.password);
      toast({ title: 'Acceso Autorizado', description: 'Sincronizando terminal de mando...' });
    } catch (error: any) {
      console.error("Error al iniciar sesión:", error);
      let errorMsg = 'Error de conexión o problema con el servidor.';
      if (error.code === 'auth/invalid-credential') {
        errorMsg = 'Correo o contraseña incorrectos.';
      } else if (error.code === 'auth/user-not-found') {
        errorMsg = 'El usuario no está registrado.';
      } else if (error.code) {
        errorMsg = `Código de error: ${error.code}`;
      }
      toast({ variant: 'destructive', title: 'Error de Acceso', description: errorMsg });
    }
  };
  
  if (isUserLoading && user) {
      return (
          <div className="h-screen w-full flex items-center justify-center bg-[#0F172A]">
              <div className="flex flex-col items-center gap-6">
                <Loader2 className="animate-spin text-blue-500 h-12 w-12" />
                <p className="text-white/40 font-black uppercase text-[10px] tracking-[0.4em]">Iniciando Sesión...</p>
              </div>
          </div>
      );
  }

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-sidebar-gradient p-6 relative overflow-hidden">
      {/* Elementos Decorativos */}
      <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-white/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] bg-primary/20 rounded-full blur-[100px] pointer-events-none" />

      <div className="w-full max-w-sm space-y-12 relative z-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
        {/* Identidad Corporativa */}
        <div className="flex flex-col items-center gap-4">
            <div className="p-4 bg-white/10 backdrop-blur-xl rounded-[2.5rem] border border-white/20 shadow-2xl">
                <DynamicAppLogo className="h-12 w-12" />
            </div>
            <div className="text-center space-y-1">
                <h2 className="text-2xl font-black uppercase tracking-tighter text-white leading-none italic">Athleticenter Pro</h2>
                <p className="text-[9px] font-black uppercase tracking-[0.4em] text-white/40">Terminal de Mando B2B</p>
            </div>
        </div>

        {/* Título de Acceso */}
        <div className="text-center space-y-3">
          <h1 className="text-xl font-black uppercase tracking-[0.3em] text-white">Acceso de Usuario</h1>
          <div className="h-0.5 w-10 bg-white/30 mx-auto rounded-full" />
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="space-y-5">
            {/* Campo Usuario */}
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-white flex items-center justify-center shadow-xl shrink-0 group hover:scale-110 transition-transform">
                <UserIcon className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <Input 
                  {...register('email')} 
                  placeholder="Usuario / Email"
                  className="h-12 rounded-full border-none bg-white text-slate-900 font-bold placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-white/50 shadow-lg text-sm" 
                />
              </div>
            </div>

            {/* Campo Contraseña */}
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-white flex items-center justify-center shadow-xl shrink-0 group hover:scale-110 transition-transform">
                <Lock className="h-5 w-5 text-primary" />
              </div>
              <div className="relative flex-1">
                <Input 
                  type={showPassword ? 'text' : 'password'} 
                  {...register('password')} 
                  placeholder="Contraseña"
                  className="h-12 rounded-full border-none bg-white text-slate-900 font-bold placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-white/50 shadow-lg text-sm" 
                />
                <button 
                  type="button" 
                  onClick={() => setShowPassword(!showPassword)} 
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-primary transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* Botón de Entrada */}
          <div className="flex items-center gap-3 pt-4">
            <div className="h-12 w-12 rounded-full bg-white flex items-center justify-center shadow-xl shrink-0 group hover:scale-110 transition-transform">
                <LogIn className="h-5 w-5 text-primary" />
            </div>
            <Button 
              type="submit" 
              disabled={isSubmitting} 
              className="h-12 flex-1 rounded-full bg-white text-primary hover:bg-slate-50 font-black uppercase tracking-[0.2em] shadow-xl border-none transition-all active:scale-95"
            >
              {isSubmitting ? <Loader2 className="animate-spin h-5 w-5" /> : 'Ingresar'}
            </Button>
          </div>

          <div className="text-center pt-2">
            <button type="button" className="text-[10px] font-bold uppercase text-white/50 hover:text-white transition-colors tracking-widest">
              ¿Olvidó su contraseña?
            </button>
          </div>

          {/* Mantener Sesión - REUBICADO DESPUÉS DE RECUPERACIÓN */}
          <div className="flex items-center justify-center gap-3 pt-2">
              <Controller
                  name="rememberMe"
                  control={control}
                  render={({ field }) => (
                      <Checkbox 
                          id="rememberMe" 
                          checked={field.value} 
                          onCheckedChange={field.onChange}
                          className="border-white/50 data-[state=checked]:bg-white data-[state=checked]:text-primary rounded-md h-5 w-5"
                      />
                  )}
              />
              <Label 
                  htmlFor="rememberMe" 
                  className="text-[10px] font-black uppercase text-white/70 tracking-widest cursor-pointer hover:text-white transition-colors"
              >
                  Mantener mi sesión iniciada
              </Label>
          </div>
        </form>

        {/* Footer Técnico */}
        <div className="pt-8 text-center">
            <p className="text-[8px] font-bold text-white/20 uppercase tracking-[0.3em]">© 2025 ATHLETICENTER PRO • TECNOLOGÍA DE PRECISIÓN</p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
    return <Suspense><LoginPageContent /></Suspense>;
}