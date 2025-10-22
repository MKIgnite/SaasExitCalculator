# Build stage
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Production stage
FROM python:3.11-alpine AS production
WORKDIR /app
COPY --from=build /app/dist ./dist
EXPOSE 2782
CMD ["python", "-m", "http.server", "2782", "--bind", "0.0.0.0", "--directory", "/app/dist"]
