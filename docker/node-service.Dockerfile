FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm ci
# The gateway serves the widget bundle (WIDGET_BUNDLE_PATH defaults to apps/widget/dist/helpix-widget.js).
RUN npm run build -w apps/widget
ENV NODE_ENV=production
CMD ["sh", "-c", "npm run start -w services/${SERVICE}"]
