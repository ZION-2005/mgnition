FROM node:20-alpine AS build

WORKDIR /app

COPY mgnition-frontend/package.json mgnition-frontend/package-lock.json ./
RUN npm ci

COPY mgnition-frontend/ ./

ARG VITE_API_BASE=/api
ARG VITE_GOOGLE_MAPS_API_KEY=

ENV VITE_API_BASE=${VITE_API_BASE}
ENV VITE_GOOGLE_MAPS_API_KEY=${VITE_GOOGLE_MAPS_API_KEY}

RUN npm run build

FROM nginx:1.27-alpine

COPY mgnition-frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
