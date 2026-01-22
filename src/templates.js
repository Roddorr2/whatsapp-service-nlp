import { BASE_URL } from "./config/index.js";

// Lista de plantillas para exponer al front-end
export const templateList = [
  {
    id: 1,
    name: "LETRAS DE ACRÍLICO",
    messages: {
      1: {
        text: `¡Hola {nombre}! 👋
Gracias por contactarnos. Somos Neon Led Publicidad ✨💡

Las *letras de acrílico* son ideales para darle a tu negocio una imagen moderna y profesional.

💬 ¿Qué tamaño y estilo tienes en mente? 👇`,
        image: "imagenes/Flyer.png",
      },
      2: {
        text: `Hola {nombre} 👋
Solo queríamos saber si tienes alguna duda sobre nuestras *letras de acrílico* 😊

Estamos atentos para ayudarte.`,
        image: "imagenes/Flyer.png",
      },
      3: {
        text: `Hola {nombre} 👋
Este es un último recordatorio sobre tu consulta por *letras de acrílico* ✨

Cuando gustes, escríbenos 😊`,
        image: "imagenes/Flyer.png",
      }
    }
  },

  {
    id: 2,
    name: "LETRAS DE ALUMINIO DORADAS 3D",
    messages: {
      1: {
        text: `¡Hola {nombre}! 👋
Gracias por escribirnos. Las *letras de aluminio doradas 3D* transmiten elegancia y alto impacto visual ✨

💬 ¿Dónde deseas instalarlas?`,
        image: "imagenes/Flyer.png",
      },
      2: {
        text: `Hola {nombre} 👋
¿Pudiste revisar la información sobre las *letras de aluminio doradas 3D*? 😊

Quedamos atentos.`,
        image: "imagenes/Flyer.png",
      },
      3: {
        text: `Hola {nombre} 👋
Este es un último mensaje para ayudarte con las *letras de aluminio doradas 3D* ✨

Cuando gustes, estamos aquí.`,
        image: "imagenes/Flyer.png",
      }
    }
  }
];


export function getTemplate(productoName, messageNumber, params = {}) {
  const { nombre = "" } = params;

  const product = templateList.find(p => p.id == productoName);

  if (!product) {
    return {
      name: "Mensahe General",
      text: `✨ Haz que tu marca brille con impacto visual

¡Hola! Te saluda Neon LED Publicidad

Creamos soluciones visuales personalizadas para que tu marca destaque y se vea profesional.

🔗 Aquí puedes ver todos nuestros productos: 
👉 https://ledneonpublicidad.com/productos/

📍 Jr. Paruro 1401 S130 - Lima 
📍 Urb. Alameda La Rivera Mz F Lt 30 - Ate

📷 Cuéntanos qué tienes en mente y te enviamos una propuesta personalizada.`,
        image: "imagenes/Flyer.png",
    };
  }

  const message = product.messages[messageNumber];

  if (!message) {
    return {
      name: "Mensahe General",
      text: `✨ Haz que tu marca brille con impacto visual

¡Hola! Te saluda Neon LED Publicidad

Creamos soluciones visuales personalizadas para que tu marca destaque y se vea profesional.

🔗 Aquí puedes ver todos nuestros productos: 
👉 https://ledneonpublicidad.com/productos/

📍 Jr. Paruro 1401 S130 - Lima 
📍 Urb. Alameda La Rivera Mz F Lt 30 - Ate

📷 Cuéntanos qué tienes en mente y te enviamos una propuesta personalizada.`,
        image: "imagenes/Flyer.png",
    };
  }

  return {
    name: nombre,
    text: message.text.replace("{nombre}", nombre),
    image: message.image || "imagenes/Flyer.png",
  };
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
        image: 'imagenes/Flyer.png'  // Ruta relativa local
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