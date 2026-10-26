const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

async function updateQR() {
  try {
    const res = await fetch('http://35.199.85.127:3001/api/status');
    const data = await res.json();
    console.log('STATUS:', data.status);
    if (data.status === 'connected') {
      console.log('✅ Ya está conectado!');
      return;
    }

    if (data.qr) {
      const qrPath = path.join(__dirname, '..', 'public', 'qr-saopaulo.png');
      // En Baileys v7, si el string empieza por https://wa.me/settings/linked_devices#, podemos usarlo directo o extraer la parte 2@...
      const qrData = data.qr;
      await QRCode.toFile(qrPath, qrData, {
        width: 400,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' }
      });
      console.log('QR guardado en:', qrPath);
      console.log('QR_RAW:', qrData);
      console.log('PAIRING_CODE:', data.pairingCode);
    }
  } catch(e) {
    console.error('Error:', e.message);
  }
}

updateQR();
