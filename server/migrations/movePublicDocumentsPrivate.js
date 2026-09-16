import fs from 'fs';
import path from 'path';
import {
  resolveProjectRoot,
  getFichierCentralDir,
  getMeetingReportsDir,
  getTermsheetsDir
} from '/imports/api/documentStorage.js';

/**
 * GDPR/security migration: earlier versions wrote client documents, order email
 * traces, meeting-report PDFs and termsheets under public/, which Meteor serves
 * as unauthenticated static assets. All writers now target private trees
 * (.fichier_central / .termsheets, or their *_PATH env overrides). This startup
 * migration moves any files still sitting under public/ into the private trees.
 *
 * Idempotent: once public/ is empty of these trees, it does nothing.
 * Conflict rule: if the private target already exists, the target wins (it is
 * the copy live code paths use); the public source is moved into a quarantine
 * folder inside the private tree instead of being overwritten or left exposed.
 */

const moveFile = (src, dest, quarantineDir, relPath, stats) => {
  if (fs.existsSync(dest)) {
    const qPath = path.join(quarantineDir, relPath);
    fs.mkdirSync(path.dirname(qPath), { recursive: true });
    fs.renameSync(src, qPath);
    stats.quarantined++;
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
    stats.moved++;
  }
};

const moveTree = (srcDir, destDir, stats) => {
  if (!fs.existsSync(srcDir)) return;
  const quarantineDir = path.join(destDir, '_migrated_from_public');

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const srcPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(srcPath);
      } else {
        const relPath = path.relative(srcDir, srcPath);
        moveFile(srcPath, path.join(destDir, relPath), quarantineDir, relPath, stats);
      }
    }
  };
  walk(srcDir);

  // Remove now-empty source directories so Meteor stops bundling them.
  const removeEmptyDirs = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) removeEmptyDirs(path.join(dir, entry.name));
    }
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  };
  removeEmptyDirs(srcDir);
};

export async function movePublicDocumentsPrivate() {
  const projectRoot = resolveProjectRoot();
  const publicDir = path.join(projectRoot, 'public');
  if (!fs.existsSync(publicDir)) return; // production container has no source public/

  const fichierCentralBase = getFichierCentralDir();
  const meetingReportsBase = getMeetingReportsDir();
  const termsheetsBase = getTermsheetsDir();

  const jobs = [
    [path.join(publicDir, 'fichier_central'), fichierCentralBase],
    [path.join(publicDir, 'meetingReports'), meetingReportsBase],
    [path.join(publicDir, 'termsheets'), termsheetsBase],
  ];

  const stats = { moved: 0, quarantined: 0 };
  try {
    for (const [src, dest] of jobs) {
      moveTree(src, dest, stats);
    }
    if (stats.moved || stats.quarantined) {
      console.log(`[movePublicDocumentsPrivate] Moved ${stats.moved} file(s) out of public/ into private storage (${stats.quarantined} duplicate(s) quarantined under _migrated_from_public)`);
    }
  } catch (error) {
    console.error('[movePublicDocumentsPrivate] Migration failed:', error.message);
  }
}
