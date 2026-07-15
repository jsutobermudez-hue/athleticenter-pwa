
'use client';

import React, { useState } from 'react';
import { useUser } from '@/firebase';
import { Loader2, User as UserIcon, Briefcase, Mail, Phone, MapPin, Edit } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { EditUserDialog } from '../users/edit-user-dialog';
import { Separator } from '@/components/ui/separator';

function LoadingScreen() {
    return (
        <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin" />
        </div>
    );
}

export default function ProfilePage() {
    const { profile, customerProfile, isUserLoading } = useUser();
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

    if (isUserLoading || !profile) {
        return <LoadingScreen />;
    }

    return (
       <>
        <div className="flex flex-col gap-6">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Mi Perfil</h1>

            <Card>
                <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                        <Avatar className="h-20 w-20 border">
                            <AvatarImage src={profile.avatarUrl} alt={profile.name} />
                            <AvatarFallback className="text-3xl">{profile.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                            <CardTitle>{profile.name}</CardTitle>
                            <CardDescription>Rol: {profile.role}</CardDescription>
                        </div>
                        <Button onClick={() => setIsEditDialogOpen(true)}><Edit className="mr-2 h-4 w-4" /> Editar Perfil</Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-6">
                    <Separator />
                     <div className="grid md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                            <h3 className="font-semibold text-lg">Información de Contacto</h3>
                            <div className="flex items-center gap-3">
                                <Mail className="h-5 w-5 text-muted-foreground" />
                                <div>
                                    <p className="text-sm text-muted-foreground">Correo Electrónico</p>
                                    <p className="font-medium">{profile.email}</p>
                                </div>
                            </div>
                             <div className="flex items-center gap-3">
                                <Phone className="h-5 w-5 text-muted-foreground" />
                                <div>
                                    <p className="text-sm text-muted-foreground">Teléfono</p>
                                    <p className="font-medium">{profile.phone || 'No disponible'}</p>
                                </div>
                            </div>
                             <div className="flex items-center gap-3">
                                <MapPin className="h-5 w-5 text-muted-foreground" />
                                <div>
                                    <p className="text-sm text-muted-foreground">Dirección</p>
                                    <p className="font-medium">{profile.address || 'No disponible'}</p>
                                </div>
                            </div>
                        </div>
                        {profile.role === 'cliente' && customerProfile && (
                            <div className="space-y-4">
                                <h3 className="font-semibold text-lg">Información de Empresa</h3>
                                 <div className="flex items-center gap-3">
                                    <Briefcase className="h-5 w-5 text-muted-foreground" />
                                    <div>
                                        <p className="text-sm text-muted-foreground">Razón Social</p>
                                        <p className="font-medium">{customerProfile.razonSocial}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Briefcase className="h-5 w-5 text-muted-foreground" />
                                    <div>
                                        <p className="text-sm text-muted-foreground">RIF</p>
                                        <p className="font-medium">{customerProfile.rif}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <UserIcon className="h-5 w-5 text-muted-foreground" />
                                    <div>
                                        <p className="text-sm text-muted-foreground">Vendedor Asignado</p>
                                        <p className="font-medium">{customerProfile.assignedSalespersonName || 'No asignado'}</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
        <EditUserDialog 
            user={profile}
            isOpen={isEditDialogOpen}
            onOpenChange={setIsEditDialogOpen}
            title="Editar Mi Perfil"
            description="Actualiza tu información de contacto."
        />
       </>
    );
}
