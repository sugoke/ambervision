import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { check } from 'meteor/check';
import { UsersCollection } from './users';
import { SessionsCollection } from './sessions';

export const NewslettersCollection = new Mongo.Collection('newsletters');

if (Meteor.isServer) {
  // Create indexes for better query performance
  Meteor.startup(() => {
    NewslettersCollection.createIndex({ uploadedAt: -1 });
    NewslettersCollection.createIndex({ category: 1 });
    NewslettersCollection.createIndex({ visibleToRoles: 1 });
  });

  // Publish newsletters to all authenticated clients
  // Simple publication - all users can see all newsletters
  Meteor.publish('newsletters', function() {
    console.log('[Newsletter Pub] Publishing newsletters');

    // Return all newsletters sorted by upload date
    return NewslettersCollection.find({}, {
      sort: { uploadedAt: -1 }
    });
  });
}

Meteor.methods({
  /**
   * Upload a new newsletter
   * @param {Object} newsletterData - Newsletter metadata and file data
   * @param {String} sessionId - Session validation
   */
  'newsletters.upload': async function(newsletterData, sessionId) {
    check(newsletterData, {
      title: String,
      description: String,
      category: String,
      filename: String,
      fileData: String, // base64
      fileSize: Number,
      visibleToRoles: [String]
    });
    check(sessionId, String);

    // Validate session
    const session = await SessionsCollection.findOneAsync({
      sessionId: sessionId,
      isActive: true,
      expiresAt: { $gt: new Date() }
    });

    if (!session) {
      throw new Meteor.Error('not-authorized', 'You must be logged in to upload newsletters');
    }

    // Get user from session
    const user = await UsersCollection.findOneAsync(session.userId);
    if (!user) {
      throw new Meteor.Error('not-authorized', 'User not found');
    }

    // Check if user is admin or superadmin
    if (user.role !== 'admin' && user.role !== 'superadmin') {
      throw new Meteor.Error('not-authorized', 'Only admins can upload newsletters');
    }

    // Validate file is PDF
    if (!newsletterData.filename.toLowerCase().endsWith('.pdf')) {
      throw new Meteor.Error('invalid-file', 'Only PDF files are allowed');
    }

    // Validate file size (max 10MB)
    if (newsletterData.fileSize > 10 * 1024 * 1024) {
      throw new Meteor.Error('file-too-large', 'File size must be less than 10MB');
    }

    // Server-side file operations (methods always run on server)
    const fs = require('fs');
    const path = require('path');

    // Generate unique filename with timestamp
    const timestamp = Date.now();
    const sanitizedFilename = newsletterData.filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueFilename = `${timestamp}_${sanitizedFilename}`;

    // Define newsletters directory path
    const publicDir = path.join(process.cwd(), '../../../public/newsletters');
    const filePath = path.join(publicDir, uniqueFilename);

    console.log('[Newsletter Upload] Public dir:', publicDir);
    console.log('[Newsletter Upload] File path:', filePath);

    // Ensure newsletters directory exists
    if (!fs.existsSync(publicDir)) {
      console.log('[Newsletter Upload] Creating directory:', publicDir);
      fs.mkdirSync(publicDir, { recursive: true });
    }

    // Convert base64 to buffer and write file
    const fileBuffer = Buffer.from(newsletterData.fileData, 'base64');
    fs.writeFileSync(filePath, fileBuffer);
    console.log(`[Newsletter Upload] File written: ${uniqueFilename} (${fileBuffer.length} bytes)`);

    // Insert newsletter document into database
    const newsletterId = await NewslettersCollection.insertAsync({
      title: newsletterData.title,
      description: newsletterData.description,
      category: newsletterData.category,
      filename: sanitizedFilename,
      uniqueFilename: uniqueFilename,
      fileUrl: `/newsletters/${uniqueFilename}`,
      fileSize: newsletterData.fileSize,
      visibleToRoles: newsletterData.visibleToRoles,
      uploadedBy: user._id,
      uploadedByEmail: user.email || user.username,
      uploadedAt: new Date(),
      downloadCount: 0,
      createdAt: new Date()
    });

    console.log(`[Newsletter Upload] Database record created: ${newsletterId} by ${user.email || user.username}`);

    return {
      success: true,
      newsletterId: newsletterId,
      fileUrl: `/newsletters/${uniqueFilename}`
    };
  },

  /**
   * Delete a newsletter
   * @param {String} newsletterId - Newsletter ID to delete
   * @param {String} sessionId - Session validation
   */
  'newsletters.delete': async function(newsletterId, sessionId) {
    check(newsletterId, String);
    check(sessionId, String);

    // Validate session
    const session = await SessionsCollection.findOneAsync({
      sessionId: sessionId,
      isActive: true,
      expiresAt: { $gt: new Date() }
    });

    if (!session) {
      throw new Meteor.Error('not-authorized', 'You must be logged in to delete newsletters');
    }

    // Get user from session
    const user = await UsersCollection.findOneAsync(session.userId);
    if (!user) {
      throw new Meteor.Error('not-authorized', 'User not found');
    }

    // Check if user is admin or superadmin
    if (user.role !== 'admin' && user.role !== 'superadmin') {
      throw new Meteor.Error('not-authorized', 'Only admins can delete newsletters');
    }

    const newsletter = await NewslettersCollection.findOneAsync(newsletterId);
    if (!newsletter) {
      throw new Meteor.Error('not-found', 'Newsletter not found');
    }

    // Delete file from filesystem (methods always run on server)
    const fs = require('fs');
    const path = require('path');

    const filePath = path.join(process.cwd(), '../../../public/newsletters', newsletter.uniqueFilename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[Newsletter Delete] File deleted: ${newsletter.uniqueFilename}`);
    } else {
      console.log(`[Newsletter Delete] File not found: ${filePath}`);
    }

    // Remove document from database
    await NewslettersCollection.removeAsync(newsletterId);

    console.log(`[Newsletter Delete] Database record deleted: ${newsletter.title} by ${user.email || user.username}`);

    return { success: true };
  },

  /**
   * Increment download count for a newsletter
   * @param {String} newsletterId - Newsletter ID
   */
  'newsletters.incrementDownload': async function(newsletterId) {
    check(newsletterId, String);

    const newsletter = await NewslettersCollection.findOneAsync(newsletterId);
    if (!newsletter) {
      return;
    }

    await NewslettersCollection.updateAsync(newsletterId, {
      $inc: { downloadCount: 1 }
    });

    console.log(`Newsletter download: ${newsletter.title}`);
  }
});
