FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG WS_URL=ws://localhost:8000
ENV WS_URL=$WS_URL
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "run", "start"]
