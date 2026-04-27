FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
EXPOSE 8080

CMD ["npx", "tsx", "src/index.ts"]
