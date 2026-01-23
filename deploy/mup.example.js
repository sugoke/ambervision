// Copy this file to mup.js and fill in your credentials
// DO NOT commit mup.js to git - it contains sensitive data

module.exports = {
  servers: {
    one: {
      host: 'YOUR_SERVER_IP',
      username: 'YOUR_USERNAME',
      password: 'YOUR_PASSWORD' // or use pem for SSH key auth
      // pem: '~/.ssh/id_rsa'
    }
  },

  app: {
    name: 'interface',
    path: '../',
    servers: { one: {} },
    buildOptions: { serverOnly: true },
    env: {
      ROOT_URL: 'https://your-domain.com',
      HTTP_FORWARDED_COUNT: '1',
      MONGO_URL: 'mongodb+srv://user:password@cluster.mongodb.net/dbname?retryWrites=true&w=majority',
      BANKFILES_PATH: '/data/bankfiles',
      TERMSHEETS_PATH: '/data/termsheets',
      FICHIER_CENTRAL_PATH: '/data/fichier_central',
      PUPPETEER_EXECUTABLE_PATH: '/usr/bin/chromium',
      PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: 'true'
    },
    docker: {
      imagePort: 3000,
      imageFrontendServer: 'nginx',
      image: 'zodern/meteor:root',
      buildInstructions: [
        'RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-color-emoji libappindicator3-1 libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 xdg-utils gnupg && rm -rf /var/lib/apt/lists/*'
      ],
      args: [
        '-v', '/path/to/bankfiles:/data/bankfiles',
        '-v', '/path/to/termsheets:/data/termsheets',
        '-v', '/path/to/fichier_central:/data/fichier_central',
        '-v', '/home/user/.gnupg:/root/.gnupg'
      ],
      prepareBundle: true,
      useBuildKit: true
    },
    volumes: {
      '/app/puppeteer': '/root/.cache/puppeteer'
    },
    enableUploadProgressBar: true
  },

  proxy: {
    domains: 'your-domain.com',
    ssl: {
      letsEncryptEmail: 'your-email@example.com',
      forceSSL: true
    }
  }
};
