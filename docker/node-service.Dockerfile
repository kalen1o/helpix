FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm ci
ENV NODE_ENV=production
CMD ["sh", "-c", "npm run start -w services/${SERVICE}"]
