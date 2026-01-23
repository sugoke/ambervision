# Ambervision Deployment Guide

## Overview

This guide covers deploying the Ambervision Structured Products application to your Hetzner server with MongoDB Atlas as the database.

## Database Configuration Strategy

The application seamlessly switches between:
- **Local Development**: Uses local MongoDB (no configuration needed)
- **Production (Hetzner)**: Uses MongoDB Atlas automatically

## Local Development Setup

### Quick Start
```bash
# Install MongoDB locally (if not already installed)
# Windows: https://docs.mongodb.com/manual/tutorial/install-mongodb-on-windows/
# Mac: brew install mongodb-community
# Linux: https://docs.mongodb.com/manual/administration/install-on-linux/

# Start the application with local MongoDB
npm start
```

The `npm start` command runs `meteor run` without any settings file, so Meteor automatically uses your local MongoDB instance.

### Alternative: Test with Atlas Locally
```bash
# To test with MongoDB Atlas connection locally
npm run start:atlas
```

## Production Deployment to Hetzner

### Prerequisites

1. **Node.js**: Install Node.js v14+ on your Hetzner server
2. **Meteor**: Install Meteor on the server
3. **MongoDB Atlas**: Ensure your cluster is accessible from Hetzner's IP

### Option 1: Environment Variables (Recommended)

This is the cleanest approach for production deployments.

#### Step 1: Set Environment Variables

Create a `.env` file or set environment variables:

```bash
export MONGO_URL="mongodb+srv://<USER>:<PASSWORD>@cluster0.ixanxcb.mongodb.net/amberlake?retryWrites=true&w=majority&appName=Cluster0"
export MONGO_OPLOG_URL="mongodb+srv://<USER>:<PASSWORD>@cluster0.ixanxcb.mongodb.net/local?retryWrites=true&w=majority&appName=Cluster0&authSource=admin"
export ROOT_URL="https://your-domain.com"
export PORT="3000"
```

#### Step 2: Run Meteor

```bash
meteor run --production
```

The application will automatically use the environment variables.

### Option 2: Settings File Approach

Use the pre-configured `settings-production.json` file.

#### Step 1: Upload Settings File

```bash
# On your local machine, copy settings-production.json to the server
scp settings-production.json user@your-hetzner-ip:/path/to/app/
```

#### Step 2: Run with Settings

```bash
meteor run --settings settings-production.json --production
```

### Systemd Service Configuration

For a production deployment, it's best to run Meteor as a systemd service.

Create `/etc/systemd/system/ambervision.service`:

```ini
[Unit]
Description=Ambervision Structured Products Application
After=network.target

[Service]
Type=simple
User=meteor
WorkingDirectory=/home/meteor/ambervision
Environment="MONGO_URL=mongodb+srv://<USER>:<PASSWORD>@cluster0.ixanxcb.mongodb.net/amberlake?retryWrites=true&w=majority&appName=Cluster0"
Environment="MONGO_OPLOG_URL=mongodb+srv://<USER>:<PASSWORD>@cluster0.ixanxcb.mongodb.net/local?retryWrites=true&w=majority&appName=Cluster0&authSource=admin"
Environment="ROOT_URL=https://your-domain.com"
Environment="PORT=3000"
Environment="NODE_ENV=production"
ExecStart=/usr/local/bin/meteor run --production
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ambervision

[Install]
WantedBy=multi-user.target
```

#### Enable and Start Service

```bash
sudo systemctl daemon-reload
sudo systemctl enable ambervision
sudo systemctl start ambervision
sudo systemctl status ambervision
```

#### View Logs

```bash
sudo journalctl -u ambervision -f
```

### Using Meteor Up (Alternative Deployment Tool)

Meteor Up (mup) is a production-quality deployment tool for Meteor apps.

#### Install Meteor Up

```bash
npm install -g mup
```

#### Initialize Configuration

```bash
mup init
```

#### Configure `mup.js`

```javascript
module.exports = {
  servers: {
    one: {
      host: 'your-hetzner-ip',
      username: 'root',
      pem: '~/.ssh/id_rsa'
    }
  },

  app: {
    name: 'ambervision',
    path: '../',

    servers: {
      one: {}
    },

    buildOptions: {
      serverOnly: true,
    },

    env: {
      ROOT_URL: 'https://your-domain.com',
      MONGO_URL: 'mongodb+srv://<USER>:<PASSWORD>@cluster0.ixanxcb.mongodb.net/amberlake?retryWrites=true&w=majority&appName=Cluster0',
      MONGO_OPLOG_URL: 'mongodb+srv://<USER>:<PASSWORD>@cluster0.ixanxcb.mongodb.net/local?retryWrites=true&w=majority&appName=Cluster0&authSource=admin'
    },

    docker: {
      image: 'abernix/meteord:node-14-base',
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
```

#### Deploy

```bash
mup setup
mup deploy
```

## MongoDB Atlas Configuration

### Whitelist Hetzner Server IP

1. Go to MongoDB Atlas dashboard
2. Navigate to Network Access
3. Click "Add IP Address"
4. Add your Hetzner server's public IP address
5. Alternatively, use `0.0.0.0/0` for testing (not recommended for production)

### Verify Connection

Test the connection from your Hetzner server:

```bash
# Install MongoDB shell
sudo apt-get install mongodb-clients

# Test connection
mongosh "mongodb+srv://<USER>:<PASSWORD>@cluster0.ixanxcb.mongodb.net/amberlake?retryWrites=true&w=majority&appName=Cluster0"
```

## NPM Scripts Reference

```bash
# Local development with local MongoDB (default)
npm start

# Local development with explicit local settings
npm run start:local

# Test Atlas connection locally
npm run start:atlas

# Production mode with Atlas
npm run start:production

# Run tests
npm test

# Run tests in watch mode
npm run test-app

# Analyze bundle size
npm run visualize
```

## Troubleshooting

### Connection Issues

**Problem**: Cannot connect to MongoDB Atlas

**Solutions**:
1. Check if Hetzner IP is whitelisted in MongoDB Atlas Network Access
2. Verify connection string is correct
3. Test connection using `mongosh`
4. Check firewall rules on Hetzner server

### Environment Variables Not Working

**Problem**: App uses local MongoDB despite setting MONGO_URL

**Solutions**:
1. Ensure MONGO_URL is exported: `export MONGO_URL="..."`
2. Check if settings file is overriding environment variables
3. Verify environment variables are set: `echo $MONGO_URL`

### Port Already in Use

**Problem**: Port 3000 already in use

**Solution**:
```bash
# Find process using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>

# Or use a different port
export PORT=3001
meteor run --production
```

### Database Name Not Found

**Problem**: MongoDB shows wrong database name

**Solution**: Ensure the database name is specified in the MONGO_URL:
```
mongodb+srv://user:pass@cluster.mongodb.net/amberlake?...
                                                  ^^^^^^^^^
                                                  Must be present
```

## Security Best Practices

1. **Never commit sensitive settings files**: `.gitignore` already excludes `settings-production.json`
2. **Use environment variables in production**: Avoid storing credentials in files on the server
3. **Rotate credentials regularly**: Change MongoDB passwords periodically
4. **Use SSL/TLS**: MongoDB Atlas enforces TLS by default
5. **Restrict network access**: Whitelist only necessary IP addresses in MongoDB Atlas
6. **Set up monitoring**: Use MongoDB Atlas monitoring and alerts

## Backup Strategy

### MongoDB Atlas Backups

MongoDB Atlas provides automatic backups:
1. Go to your cluster in Atlas
2. Navigate to "Backup" tab
3. Configure backup schedule and retention policy
4. Test restore process periodically

### Application Code Backups

```bash
# Backup application code
tar -czf ambervision-backup-$(date +%Y%m%d).tar.gz /home/meteor/ambervision

# Backup to remote location
rsync -avz /home/meteor/ambervision/ backup-server:/backups/ambervision/
```

## Monitoring

### Check Application Health

```bash
# Check if application is running
curl http://localhost:3000

# Check MongoDB connection from application logs
sudo journalctl -u ambervision | grep "MONGO_URL"
```

### MongoDB Atlas Monitoring

1. MongoDB Atlas dashboard provides:
   - Connection metrics
   - Query performance
   - Database size and growth
   - Real-time performance charts

2. Set up alerts for:
   - High connection count
   - Slow queries
   - Disk space usage
   - Replication lag

## Support

For issues specific to:
- **Meteor**: https://docs.meteor.com/
- **MongoDB Atlas**: https://docs.atlas.mongodb.com/
- **Hetzner**: https://docs.hetzner.com/

---

**Last Updated**: December 2024
