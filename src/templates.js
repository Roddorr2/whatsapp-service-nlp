import { BASE_URL } from "./config/index.js";

// Lista de plantillas para exponer al front-end
export const templateList = [
  {
    id: "LETRAS DE ACRÍLICO",
    name: "LETRAS DE ACRÍLICO",
    messages: {
      1: {
        text: `¡Hola {nombre}! 👋
Gracias por contactarnos. Somos Neon Led Publicidad ✨💡

Las *letras de acrílico* son ideales para darle a tu negocio una imagen moderna y profesional.

💬 ¿Qué tamaño y estilo tienes en mente? 👇`,
        image: "imagenes/Flyer.jpg",
      },
      2: {
        text: `Hola {nombre} 👋
Solo queríamos saber si tienes alguna duda sobre nuestras *letras de acrílico* 😊

Estamos atentos para ayudarte.`,
      },
      3: {
        text: `Hola {nombre} 👋
Este es un último recordatorio sobre tu consulta por *letras de acrílico* ✨

Cuando gustes, escríbenos 😊`,
      }
    }
  },

  {
    id: "LETRAS DE ALUMINIO DORADAS 3D",
    name: "LETRAS DE ALUMINIO DORADAS 3D",
    messages: {
      1: {
        text: `¡Hola {nombre}! 👋
Gracias por escribirnos. Las *letras de aluminio doradas 3D* transmiten elegancia y alto impacto visual ✨

💬 ¿Dónde deseas instalarlas?`,
        image: "imagenes/Flyer.jpg",
      },
      2: {
        text: `Hola {nombre} 👋
¿Pudiste revisar la información sobre las *letras de aluminio doradas 3D*? 😊

Quedamos atentos.`,
      },
      3: {
        text: `Hola {nombre} 👋
Este es un último mensaje para ayudarte con las *letras de aluminio doradas 3D* ✨

Cuando gustes, estamos aquí.`,
      }
    }
  }
];


export function getTemplate(productoName, messageNumber, params = {}) {
  const { nombre = "" } = params;

  const product = templateList.find(p => p.id === productoName);

  if (!product) {
    return {
      text: `Hola ${nombre} 👋 Gracias por escribirnos a Neon Led Publicidad ✨`,
    };
  }

  const message = product.messages[messageNumber];

  if (!message) {
    return {
      text: `Hola ${nombre} 👋 Gracias por tu interés en ${product.name} ✨`,
    };
  }

  return {
    name: nombre,
    text: message.text.replace("{nombre}", nombre),
    image: message.image || null,
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