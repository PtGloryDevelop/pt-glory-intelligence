FROM mcr.microsoft.com/playwright:v1.59.0-noble
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=8787 HEADLESS=true
EXPOSE 8787
CMD ["npm", "start"]
