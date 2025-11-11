FROM node:20-alpine AS build
WORKDIR /app

COPY ui/package.json ui/package-lock.json ./
RUN npm ci --ignore-scripts

COPY ui/ ./
RUN npm run build

FROM nginx:1.27-alpine
WORKDIR /usr/share/nginx/html

COPY --from=build /app/dist/ ./
COPY ui/content.json ./content.json

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

