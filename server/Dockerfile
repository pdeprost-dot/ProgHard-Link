FROM node:22.19.0-alpine3.22
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
