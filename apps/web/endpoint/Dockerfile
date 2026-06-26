FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY server.mjs ./

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

USER node

CMD ["node", "server.mjs"]
