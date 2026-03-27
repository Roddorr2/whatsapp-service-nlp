FROM node:22-alpine

#  Instalar certificados y herramientas de red
RUN apk add --no-cache \
    ca-certificates \
    curl \
    bash \
    tzdata \
    tini && \
    update-ca-certificates

WORKDIR /app

# Copia package.json y patches antes de instalar dependencias
COPY package*.json ./
COPY patches ./patches

# Instala dependencias de producción y aplica el patch automáticamente
RUN npm ci --omit=dev

# Copia el resto del código
COPY . .

# Expone el puerto
EXPOSE 5112

# Usa tini como init process
ENTRYPOINT ["/sbin/tini", "--"]

# Ejecuta la aplicación
CMD ["node", "index.js"]
