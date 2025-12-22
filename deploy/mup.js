module.exports = {
  servers: {
    one: {
      host: '95.217.233.6',
      username: 'michael',
      password: 'Sugoke14' // switch to SSH key soon
    }
  },

  app: {
    name: 'interface',
    // If .deploy is inside your app repo, keep '../'. If .deploy is at the app root, use '.'
    path: '../',
    servers: { one: {} },
    buildOptions: { serverOnly: true },
    env: {
      ROOT_URL: 'https://vision.amberlakepartners.com',
      HTTP_FORWARDED_COUNT: '1',
      MONGO_URL: 'mongodb+srv://sugoke:sugoke14@cluster0.ixanxcb.mongodb.net/amberlake?retryWrites=true&w=majority&appName=Cluster0',
      BANKFILES_PATH: '/data/bankfiles',
      TERMSHEETS_PATH: '/data/termsheets',
      // Puppeteer configuration - use system Chromium
      PUPPETEER_EXECUTABLE_PATH: '/usr/bin/chromium',
      PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: 'true'
      // Do NOT set DDP_DEFAULT_CONNECTION_URL
      // PORT is managed automatically by the proxy - do not set it here
      // SFTP_PRIVATE_KEY is configured in settings-production.json
    },
    // Settings file is passed via meteor --settings flag
    // For mup, settings are managed via env.METEOR_SETTINGS or settings property
    docker: {
      imagePort: 3000,
      imageFrontendServer: 'nginx',
      image: 'zodern/meteor:root',
      // Install Chromium and dependencies for Puppeteer PDF generation
      buildInstructions: [
        'RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-color-emoji libappindicator3-1 libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 xdg-utils && rm -rf /var/lib/apt/lists/*'
      ],
      // Mount Hetzner persistent volumes for bank files and termsheets
      args: [
        '-v', '/mnt/HC_Volume_103962382/bankfiles:/data/bankfiles',
        '-v', '/mnt/HC_Volume_103962382/termsheets:/data/termsheets'
      ],
      prepareBundle: true,
      useBuildKit: true
    },
    volumes: {
      // Persistent volume for Puppeteer cache
      '/app/puppeteer': '/root/.cache/puppeteer'
    },
    enableUploadProgressBar: true
  },

  // Let Mup manage Nginx + Let's Encrypt
proxy: {
  domains: 'vision.amberlakepartners.com',
  ssl: {
    letsEncryptEmail: 'mf@amberlakepartners.com',
    forceSSL: true
  }
}

};
