export const chatbotFlow = {
  start: {
    message: `👋 BIENVENIDO\n\nESCOGE EL SERVICIO QUE DESEAS INFORMACIÓN:\n1️⃣ Desarrollo\n2️⃣ Tester\n3️⃣ Diseño\n4️⃣ Marketing`,
    next: { 
      "1": "desarrollo", 
      "2": "tester", 
      "3": "diseño",
      "4": "marketing"
    }
  },

  desarrollo: {
    message: `💻 DESARROLLO\n\nEscoge una de las siguientes opciones:\n1️⃣ PHP\n2️⃣ Python\n3️⃣ Node.js\n4️⃣ Cierre`,
    next: { 
      "1": "php", 
      "2": "python", 
      "3": "node",
      "4": "cierre" 
    }
  },

  tester: {
    message: `🧪 TESTER\n\nTenemos información sobre QA manual y automatizado.\n1️⃣ QA Manual\n2️⃣ QA Automatizado\n3️⃣ Cierre`,
    next: { 
      "1": "qa_manual", 
      "2": "qa_auto",
      "3": "cierre"
    }
  },

  diseño: {
    message: `🎨 DISEÑO\n\nOpciones:\n1️⃣ UX/UI\n2️⃣ Gráfico\n3️⃣ Cierre`,
    next: { 
      "1": "uxui", 
      "2": "grafico",
      "3": "cierre"
    }
  },

  marketing: {
    message: `📢 MARKETING\n\nOpciones:\n1️⃣ SEO\n2️⃣ Redes Sociales\n3️⃣ Cierre`,
    next: { 
      "1": "seo", 
      "2": "redes",
      "3": "cierre"
    }
  },

  // Hojas finales
  php: { message: `📘 Has escogido PHP 🚀`, next: {} },
  python: { message: `🐍 Has escogido Python ⚡`, next: {} },
  node: { message: `🟢 Has escogido Node.js 🚀`, next: {} },
  qa_manual: { message: `📝 QA Manual: Se centra en pruebas exploratorias y casos de uso.`, next: {} },
  qa_auto: { message: `🤖 QA Automatizado: Uso de herramientas como Selenium o Cypress.`, next: {} },
  uxui: { message: `🎨 UX/UI: Diseño de interfaces centradas en el usuario.`, next: {} },
  grafico: { message: `🖼️ Diseño gráfico: Branding, banners, ilustraciones.`, next: {} },
  seo: { message: `🔍 SEO: Optimización en motores de búsqueda.`, next: {} },
  redes: { message: `📱 Redes Sociales: Estrategias en Facebook, Instagram, TikTok.`, next: {} },

  cierre: { 
    message: `✅ Gracias por tu interés, un asesor se pondrá en contacto contigo.`, 
    next: {} 
  }
};
