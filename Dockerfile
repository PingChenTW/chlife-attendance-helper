FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 APP_MODE=live ALLOW_WRITES=false
EXPOSE 8080
USER node
CMD ["node", "src/server.mjs"]
