import { BASE_URL } from "./config/index.js";

// Lista de plantillas para exponer al front-end
export const templateList = [
  {
    id: "1",
    name: "LETRAS DE ACRÍLICO",
    text: `¡Hola {nombre}!👋
Gracias por contactarnos. Somos Neon Led Publicidad ✨💡

Las *letras de acrílico* son ideales para darle a tu negocio una imagen moderna, elegante y profesional.

✅ Excelente visibilidad
✅ Acabados personalizados
✅ Perfectas para interiores y exteriores

💬 Cuéntanos: ¿qué tamaño y estilo tienes en mente para tus letras? 👇`,
    image: "imagenes/Flyer.jpg",
  },
  {
    id: "2",
    name: "LETRAS DE ALUMINIO DORADAS 3D",
    text: `¡Hola {nombre}!👋
Gracias por escribirnos. Somos Neon Led Publicidad ✨💡

Las *letras de aluminio doradas 3D* transmiten elegancia, prestigio y alto impacto visual.

✅ Acabado premium
✅ Alta durabilidad
✅ Ideal para marcas exclusivas

💬 Cuéntanos: ¿en qué espacio deseas instalarlas y qué tamaño necesitas? 👇`,
    image: "imagenes/Flyer.jpg",
  },
  {
    id: "3",
    name: "LETRAS DE ALUMINIO PLATEADA 3D",
    text: `¡Hola {nombre}!👋
Gracias por contactarnos. Somos Neon Led Publicidad ✨💡

Las *letras de aluminio plateadas 3D* ofrecen un diseño moderno y profesional para tu negocio.

✅ Estilo elegante
✅ Alta resistencia
✅ Excelente presencia visual

💬 Cuéntanos: ¿para interior o exterior y qué dimensiones estás buscando? 👇`,
    image: "imagenes/Flyer.jpg",
  },
  {
    id: "4",
    name: "LETREROS LUMINOSOS",
    text: `¡Hola {nombre}!👋
Gracias por comunicarte con Neon Led Publicidad ✨💡

Los *letreros luminosos* hacen que tu marca destaque de día y de noche.

✅ Máxima visibilidad
✅ Tecnología LED de bajo consumo
✅ Diseños personalizados

💬 Cuéntanos: ¿qué tipo de letrero necesitas y dónde lo piensas instalar? 👇`,
    image: "imagenes/Flyer.jpg",
  },
  {
    id: "5",
    name: "Prueba",
    text: `Hola {nombre}👋
Gracias por contactarnos. Somos Neon Led Publicidad ✨💡

Este es un mensaje de prueba para validar el envío de plantillas.

💬 Escríbenos para continuar 👇`,
    image: "imagenes/default.jpg",
  },
];

// Función existente
export function getTemplate(option, params = {}) {
  const { nombre = "", image = "" } = params;
  const template = templateList.find(t => t.id === option);

  if (!template) {
    return { 
      name: "General",
      text: `✨ ¡Hola ${nombre}! Te saluda Neon Led Publicidad 💡✨

Potencia la visibilidad de tu negocio con soluciones publicitarias modernas y personalizadas.

📌 Letras corpóreas
📌 Letreros luminosos
📌 Diseños a medida

¡Estamos listos para ayudarte a destacar! 🚀`,
      image: "imagenes/Flyer.jpg",
    };
  }

  return {
    name: template.name,
    text: template.text.replace("{nombre}", nombre),
    image: image || template.image,
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