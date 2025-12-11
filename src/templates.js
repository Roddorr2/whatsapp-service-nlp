import { BASE_URL } from "./config/index.js";

//plantilla para enviar mensaje por popups
export function getTemplate(option, params = {}) {
  const {
    nombre = '',
    fecha = '',
    hora = '',
    productoName = 'un producto que te encantará'
  } = params;

  console.log("📝 Plantilla generada:", params);

  switch (option) {
    case 'cita_gratis': //bienvenida
      return {
        text: `✨ ¡Hola ${nombre}! Te saluda Digimedia. 💻🚀

          Potencia tu presencia online con una página web profesional y personalizada para tu marca.

          Te ayudamos con:

            🌐 Diseño web *moderno y a tu medida*.
            ⚡ Desarrollo optimizado y veloz.
            📱 100% adaptable a móviles.
            🎯 SEO listo para posicionarte en Google.
            💰 Inversión inteligente que multiplica tus ventas.

            👉 Todo en un solo servicio creado para hacer crecer tu negocio sin límites.

              "𝘚𝘪 𝘵𝘶 𝘯𝘦𝘨𝘰𝘤𝘪𝘰 𝘯𝘰 𝘦𝘴𝘵𝘢́ 𝘦𝘯 𝘐𝘯𝘵𝘦𝘳𝘯𝘦𝘵, 𝘵𝘶 𝘯𝘦𝘨𝘰𝘤𝘪𝘰 𝘯𝘰 𝘦𝘹𝘪𝘴𝘵𝘦." -Bill gates

          Tu negocio no puede esperar más para crecer.

          Hazlo digital con *DigiMedia.*`,
                  image: 'imagenes/Flyer.jpg'  // Ruta relativa local
      };
    
    case 'producto': // Nuevo caso para cualquier producto
      return {
        text: `🌟 ¡Hola ${nombre}! Te saluda Neon Led Publicidad. 💻🚀

          Gracias por tu interés en **${productoName}**.

          Para darte la mejor cotización y asesoría personalizada sobre este producto, por favor confírmanos:
          
          ✅ *Tipo de acabado* (ej. brillante, mate).
          ✅ *Tamaño y cantidad* que necesitas.
          ✅ *Uso principal* (interior/exterior, fijo/móvil).

          Estamos listos para ayudarte a destacar tu marca con **${productoName}**. ¡Cuéntanos más para comenzar!`,
          image: 'imagenes/Flyer.jpg' // Ruta relativa local
      };

      default:
        return {
          text: `Holas ${nombre}, este es un mensaje automático.`,
          image: 'imagenes/default.jpg'  // Ruta relativa local
        };
  }
}

//plantilla para enviar mensaje de acuerdo al mensaje
export function getTemplateMessage(option, params = {}) {
  const {
    nombre = '',
    fecha = '',
    hora = '',
    image=''
  } = params;

  console.log("📝 Plantilla generada:", params);

  switch (option) {
    case 'cita_gratis':
      return {
        text: `¡Hola 👋

✅ Tu primera cita GRATUITA ha sido confirmada:

📅 Fecha: ${fecha}
🕐 Hora: ${hora}
👨‍⚕️ Psicólogo: ${nombre}

🎉 ¡Recuerda que tu primera consulta es completamente GRATIS!

Si tienes alguna consulta, no dudes en contactarnoss.

¡Te esperamos! 🌟`,
        image: image  // Ya es una ruta relativa pasada desde el frontend
      };

    default:
      return {
        text: `Hola ${nombre}, este es un mensaje automático.`,
        image: 'imagenes/Flyer.jpg'  // Ruta relativa local
      };
  }
}

// Template para mensaje de pago aceptado
export function getAcceptanceTemplate(comentario = '') {
  return `✅ COMPROBANTE APROBADO ✅

🎉 ¡Excelente! Tu comprobante de pago ha sido revisado y aprobado.

📋 Estado de la revisión:
   - ✅ APROBADO
   - 📅 Fecha de revisión: ${new Date().toLocaleDateString('es-ES')}
   - 🕐 Hora: ${new Date().toLocaleTimeString('es-ES')}

${comentario ? `💬 Comentario del administrador:
"${comentario}"

` : ''}🔒 Tu información está segura con nosotros.

Si tienes alguna pregunta sobre tu pago, no dudes en contactarnos.

¡Gracias por tu paciencia! 🌟`;
}

// Template para mensaje de pago rechazado
export function getRejectionTemplate(comentario = '') {
  return `❌ COMPROBANTE RECHAZADO ❌

⚠️ Tu comprobante de pago no pudo ser aprobado.

📋 Estado de la revisión:
   - ❌ RECHAZADO
   - 📅 Fecha de revisión: ${new Date().toLocaleDateString('es-ES')}
   - 🕐 Hora: ${new Date().toLocaleTimeString('es-ES')}

${comentario ? `💬 Comentario del administrador:
"${comentario}"

` : ''}🔄 Para resolver este problema:

1. 📸 Sube una nueva foto del comprobante
2. 🔍 Asegúrate de que se vea claramente:
   - Número de referencia
   - Monto pagado
   - Fecha del pago
   - Nombre del remitente
3. 📱 La imagen debe estar nítida y completa

📞 Si necesitas ayuda, contáctanos inmediatamente.

¡Estamos aquí para ayudarte a resolverlo! 🤝`;
}