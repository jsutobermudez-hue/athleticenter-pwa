const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function generateFriendlyPDF() {
  const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Guía Práctica de WhatsApp para Empleados - Athleticenter</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Open+Sans:wght@400;600;700&display=swap');

    @page {
      size: A4;
      margin: 15mm 15mm 15mm 15mm;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Open Sans', Arial, sans-serif;
      color: #1e293b;
      line-height: 1.6;
      font-size: 13px;
      background: #ffffff;
    }

    .page {
      page-break-after: always;
      position: relative;
      padding: 10px 0;
    }

    .page:last-child {
      page-break-after: avoid;
    }

    /* Portada Súper Comercial */
    .cover-box {
      background: linear-gradient(135deg, #1e3a8a 0%, #0284c7 100%);
      color: white;
      border-radius: 16px;
      padding: 50px 35px;
      text-align: center;
      margin-top: 40px;
      box-shadow: 0 10px 25px rgba(30, 58, 138, 0.2);
    }

    .logo-badge {
      display: inline-block;
      background: #f59e0b;
      color: #000;
      font-family: 'Montserrat', sans-serif;
      font-weight: 800;
      font-size: 14px;
      padding: 6px 16px;
      border-radius: 20px;
      margin-bottom: 25px;
      letter-spacing: 1px;
    }

    h1 {
      font-family: 'Montserrat', sans-serif;
      font-size: 32px;
      font-weight: 800;
      line-height: 1.2;
      margin-bottom: 15px;
    }

    .cover-desc {
      font-size: 16px;
      max-width: 520px;
      margin: 0 auto 30px auto;
      opacity: 0.95;
    }

    .cover-points {
      background: rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      padding: 20px;
      text-align: left;
      max-width: 480px;
      margin: 0 auto;
      font-size: 14px;
    }

    .cover-points div {
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .cover-points div:last-child {
      margin-bottom: 0;
    }

    /* Estilo de Capítulos */
    .header-bar {
      border-bottom: 3px solid #0284c7;
      padding-bottom: 8px;
      margin-bottom: 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .header-bar h2 {
      font-family: 'Montserrat', sans-serif;
      font-size: 20px;
      color: #0f172a;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .step-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 14px;
      display: flex;
      gap: 14px;
      align-items: flex-start;
    }

    .step-circle {
      background: #0284c7;
      color: white;
      font-family: 'Montserrat', sans-serif;
      font-weight: 800;
      font-size: 15px;
      min-width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .step-text h3 {
      font-family: 'Montserrat', sans-serif;
      font-size: 15px;
      color: #1e3a8a;
      margin-bottom: 4px;
    }

    .step-text p {
      font-size: 12.5px;
      color: #334155;
      margin: 0;
    }

    .alert-green {
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
      border-left: 5px solid #10b981;
      padding: 12px 16px;
      border-radius: 8px;
      margin: 15px 0;
      color: #065f46;
    }

    .alert-red {
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-left: 5px solid #ef4444;
      padding: 14px 18px;
      border-radius: 8px;
      margin: 15px 0;
      color: #991b1b;
    }

    .alert-yellow {
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-left: 5px solid #f59e0b;
      padding: 12px 16px;
      border-radius: 8px;
      margin: 15px 0;
      color: #92400e;
    }

    .chat-bubble {
      background: #e0f2fe;
      border: 1px solid #bae6fd;
      border-radius: 12px;
      padding: 14px 16px;
      margin: 10px 0;
      font-style: italic;
      color: #0369a1;
      font-size: 12.5px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0;
      font-size: 12px;
    }

    th {
      background: #1e3a8a;
      color: white;
      text-align: left;
      padding: 8px 10px;
      font-family: 'Montserrat', sans-serif;
    }

    td {
      padding: 8px 10px;
      border-bottom: 1px solid #e2e8f0;
      background: #ffffff;
    }

    tr:nth-child(even) td {
      background: #f8fafc;
    }

    .highlight {
      background: #fef08a;
      padding: 2px 5px;
      font-weight: 700;
      border-radius: 3px;
      color: #854d0e;
    }
  </style>
</head>
<body>

  <!-- PORTADA -->
  <div class="page">
    <div class="cover-box">
      <div class="logo-badge">ATHLETICENTER • TIENDA DEPORTIVA</div>
      <h1>GUÍA FÁCIL DE WHATSAPP PARA EMPLEADOS</h1>
      <p class="cover-desc">
        Manual paso a paso para promocionar productos, enviar ofertas a clientes y atender las ventas por WhatsApp.
      </p>

      <div class="cover-points">
        <div>👉 <strong>1. Dónde está la sección en el sistema</strong></div>
        <div>👉 <strong>2. Cómo enviar una promoción a los clientes</strong></div>
        <div>👉 <strong>3. El catálogo automático de los Lunes y Jueves</strong></div>
        <div>👉 <strong>4. Qué responderle al cliente cuando quiere comprar</strong></div>
        <div>👉 <strong>5. Reglas obligatorias de precios y descuentos</strong></div>
      </div>
    </div>

    <div style="text-align: center; margin-top: 40px; color: #64748b; font-size: 12px;">
      Manual Oficial de Trabajo • Athleticenter C.A. • Octubre 2026
    </div>
  </div>

  <!-- PÁGINA 1: DÓNDE ESTÁ Y CÓMO ENVIAR PROMOCIONES -->
  <div class="page">
    <div class="header-bar">
      <h2>⚡ 1. ¿Dónde está la sección en la computadora?</h2>
    </div>

    <div class="step-card">
      <div class="step-circle">1</div>
      <div class="step-text">
        <h3>Entra a tu menú en la pantalla</h3>
        <p>En la barra del lado izquierdo de la pantalla de Athleticenter, busca la opción que tiene un rayo amarillo llamada: <br>
        👉 <strong style="font-size: 14px; color: #1e3a8a;">"Radar Marketing"</strong></p>
      </div>
    </div>

    <div class="step-card">
      <div class="step-circle">2</div>
      <div class="step-text">
        <h3>La pantalla principal</h3>
        <p>Al hacer clic verás la lista de tus mejores clientes, los clientes que tienen tiempo sin venir a comprar y el historial de lo que se ha enviado.</p>
      </div>
    </div>

    <div class="header-bar" style="margin-top: 25px;">
      <h2>📢 2. ¿Cómo enviar una promoción con foto a los clientes?</h2>
    </div>

    <p style="margin-bottom: 12px;">Para mandar una oferta de algún zapato, balón o ropa que tengamos en la tienda, solo sigue estos 4 pasos sencillos:</p>

    <div class="step-card">
      <div class="step-circle">A</div>
      <div class="step-text">
        <h3>Haz clic en el botón de Megáfono</h3>
        <p>En la esquina superior derecha, haz clic en el botón azul que dice: <strong>"Nueva Difusión Masiva"</strong>.</p>
      </div>
    </div>

    <div class="step-card">
      <div class="step-circle">B</div>
      <div class="step-text">
        <h3>Elige a quién quieres enviárselo</h3>
        <p>
          • <strong>Clientes VIP:</strong> A los que compran más seguido.<br>
          • <strong>Clientes Inactivos:</strong> A los que tienen más de 30 días sin visitarnos.<br>
          • <strong>Todos:</strong> A toda la lista de clientes registrados.
        </p>
      </div>
    </div>

    <div class="step-card">
      <div class="step-circle">C</div>
      <div class="step-text">
        <h3>Elige el producto que quieres vender</h3>
        <p>En la lista de productos, selecciona el artículo (por ejemplo, un balón o un calzado). El sistema pondrá solito el nombre del producto, el precio con descuento y <strong>adjuntará la foto real que tenemos en el inventario</strong>.</p>
      </div>
    </div>

    <div class="step-card">
      <div class="step-circle">D</div>
      <div class="step-text">
        <h3>Haz clic en "Iniciar Difusión"</h3>
        <p>¡Listo! El sistema empezará a mandar los mensajes con su foto uno por uno a los clientes de forma segura.</p>
      </div>
    </div>
  </div>

  <!-- PÁGINA 2: EL CATÁLOGO AUTOMÁTICO DE LUNES Y JUEVES -->
  <div class="page">
    <div class="header-bar">
      <h2>🗓️ 3. El Catálogo Automático de los Lunes y Jueves</h2>
    </div>

    <div class="alert-green">
      <strong>¡El sistema trabaja solo dos veces por semana!</strong><br>
      No tienes que hacer nada manual para esto. La computadora selecciona y envía automáticamente el catálogo a los clientes en estos dos horarios:
    </div>

    <table>
      <tr>
        <th style="width: 30%;">Día</th>
        <th style="width: 25%;">Hora</th>
        <th style="width: 45%;">¿Qué envía?</th>
      </tr>
      <tr>
        <td><strong>TODOS LOS LUNES</strong></td>
        <td>10:00 AM</td>
        <td>Catálogo de inicio de semana con la foto del producto estrella.</td>
      </tr>
      <tr>
        <td><strong>TODOS LOS JUEVES</strong></td>
        <td>02:30 PM</td>
        <td>Catálogo de fin de semana para incentivar las compras del viernes y sábado.</td>
      </tr>
    </table>

    <h3 style="font-family: 'Montserrat', sans-serif; margin-top: 15px; margin-bottom: 8px; color: #1e3a8a;">
      ¿Qué 6 productos selecciona el sistema en el catálogo?
    </h3>
    <p>Para vender más y ayudar a la tienda a mover la mercancía, el sistema elige exactamente 6 productos:</p>
    
    <div style="background: #f1f5f9; padding: 12px 16px; border-radius: 8px; margin-bottom: 15px;">
      <p style="margin-bottom: 6px;">
        🔥 <strong>3 Productos que están de moda (Tendencia):</strong> Los que más se están vendiendo en la tienda y de los que tenemos existencia en almacén.
      </p>
      <p style="margin-bottom: 0;">
        💎 <strong>3 Productos que tienen tiempo sin salir (Oportunidades):</strong> Ropa o calzado que casi no rota, para mostrarlos a los clientes y que se vendan rápido.
      </p>
    </div>

    <h3 style="font-family: 'Montserrat', sans-serif; margin-bottom: 8px; color: #1e3a8a;">
      Ejemplo de lo que recibe el cliente en su WhatsApp:
    </h3>

    <div style="background: #fff; border: 2px solid #cbd5e1; border-radius: 10px; padding: 12px 16px; font-size: 12px; color: #334155;">
      📸 <em>[Foto real del producto principal de inventario]</em><br><br>
      ⭐ <strong>¡CATÁLOGO EXCLUSIVO ATHLETICENTER!</strong> ⭐<br>
      Hola, preparamos para ti esta selección especial de la semana:<br><br>
      🔥 <strong>LO MÁS PEDIDO DE LA SEMANA:</strong><br>
      1️⃣ Balón Adidas Trionda FIFA 2026 - $12.50 <em>(De contado en divisas: $8.44)</em><br>
      2️⃣ Gorra Nike Club Cap - $25.00 <em>(De contado en divisas: $16.88)</em><br>
      3️⃣ Camiseta Under Armour Tech - $35.00 <em>(De contado en divisas: $23.63)</em><br><br>
      💎 <strong>OPORTUNIDADES DESTACADAS (ÚLTIMAS PIEZAS):</strong><br>
      4️⃣ Short Deportivo Puma Pro - $28.00 <em>(De contado en divisas: $18.90)</em><br>
      5️⃣ Medias Deportivas Pack x3 - $9.00 <em>(De contado en divisas: $6.08)</em><br>
      6️⃣ Muñequeras Wilson Tennis - $14.00 <em>(De contado en divisas: $9.45)</em><br><br>
      💡 <em>Responde a este mensaje con el número de la opción que deseas apartar (Ej: "Quiero el 1" o "Me interesa el 2").</em><br><br>
      <strong>Somos el equipo de Athleticenter 💙🏅</strong>
    </div>
  </div>

  <!-- PÁGINA 3: QUÉ HACER CUANDO EL CLIENTE RESPONDE Y REGLAS DE ORO -->
  <div class="page">
    <div class="header-bar">
      <h2>💬 4. ¿Qué hacer cuando un cliente responde al WhatsApp?</h2>
    </div>

    <p>Cuando un cliente escribe un número (por ejemplo: <em>"Quiero el 1"</em> o simplemente <em>"2"</em>), debes seguir este orden:</p>

    <div class="step-card">
      <div class="step-circle">1</div>
      <div class="step-text">
        <h3>Revisar la existencia en tienda</h3>
        <p>Ve de inmediato al módulo de <strong>Inventario</strong> o al almacén físico para comprobar que quede la talla o el modelo exacto que el cliente pide.</p>
      </div>
    </div>

    <div class="step-card">
      <div class="step-circle">2</div>
      <div class="step-text">
        <h3>Apartar la prenda en el mostrador</h3>
        <p>Toma la pieza física y colócala en el área de apartados de tienda para que otro vendedor no la vaya a vender mientras el cliente viene.</p>
      </div>
    </div>

    <div class="step-card">
      <div class="step-circle">3</div>
      <div class="step-text">
        <h3>Responderle con amabilidad y darle el monto</h3>
        <p>Escríbele confirmando su apartado, el monto total a pagar y recuérdale los métodos de pago (efectivo en divisas, Zelle o Pago Móvil).</p>
      </div>
    </div>

    <div class="chat-bubble">
      <strong>Mensaje modelo que puedes enviarle:</strong><br>
      <em>"¡Hola! Con gusto, ya tenemos apartada tu opción en mostrador. El total con el descuento de divisas aplicado es de $[MONTO]. ¿Cuándo nos visitas en tienda para coordinar tu retiro? Somos el equipo de Athleticenter."</em>
    </div>

    <div class="header-bar" style="margin-top: 25px;">
      <h2>⛔ 5. Reglas de Oro Inviolables (Muy Importante)</h2>
    </div>

    <div class="alert-red">
      <h3 style="font-family: 'Montserrat', sans-serif; margin-bottom: 6px; font-size: 14px;">1. POLÍTICA DE PRECIOS Y DESCUENTOS</h3>
      <p style="margin: 0; font-size: 12.5px;">
        La única promoción autorizada es: <br>
        • <span class="highlight">25% de descuento</span> pagando en divisas.<br>
        • <span class="highlight">+ 10% adicional</span> si paga de contado / al instante.<br>
        <strong>Está terminantemente prohibido inventar o dar otros descuentos por cuenta propia.</strong>
      </p>
    </div>

    <div class="alert-yellow">
      <h3 style="font-family: 'Montserrat', sans-serif; margin-bottom: 6px; font-size: 14px;">2. CÓMO FIRMAR LOS MENSAJES</h3>
      <p style="margin: 0; font-size: 12.5px;">
        Todos los mensajes deben terminar siempre diciendo:<br>
        👉 <strong style="font-size: 14px;">"Somos el equipo de Athleticenter"</strong><br>
        <strong>Nunca debes poner tu nombre personal de vendedor</strong> (no pongas "Atendido por Carlos" ni nada parecido). El cliente es atendido por la tienda en equipo.
      </p>
    </div>
  </div>

</body>
</html>
  `;

  const webDocsDir = path.join(__dirname, '..', 'public', 'docs');
  if (!fs.existsSync(webDocsDir)) {
    fs.mkdirSync(webDocsDir, { recursive: true });
  }

  const webPdfPath = path.join(webDocsDir, 'Manual_Usuario_Modulo_Marketing_WhatsApp_Athleticenter.pdf');
  const desktopPdfPath = 'C:\\Users\\Justo Noe\\Desktop\\App Athleticenter\\Manual_Usuario_Modulo_Marketing_WhatsApp_Athleticenter.pdf';

  console.log('Iniciando Puppeteer para generar versión amigable y 100% clara...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

  console.log('Guardando PDF claro y visual...');
  await page.pdf({
    path: webPdfPath,
    format: 'A4',
    printBackground: true,
    margin: {
      top: '0mm',
      bottom: '0mm',
      left: '0mm',
      right: '0mm'
    }
  });

  fs.copyFileSync(webPdfPath, desktopPdfPath);
  await browser.close();
  console.log('Manual amigable generado con éxito en ambos destinos.');
}

generateFriendlyPDF().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
