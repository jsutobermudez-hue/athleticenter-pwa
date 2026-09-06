import fs from 'fs';
import path from 'path';

const srcDir = './src';
const collections = new Set();

function scanDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      scanDir(fullPath);
    } else if (stat.isFile() && (file.endsWith('.ts') || file.endsWith('.tsx'))) {
      const content = fs.readFileSync(fullPath, 'utf8');
      
      // Match pattern: collection(anything, 'collectionName')
      const regex1 = /collection\([^,]+,\s*['"]([a-zA-Z0-9_-]+)['"]\)/g;
      let match;
      while ((match = regex1.exec(content)) !== null) {
        collections.add(match[1]);
      }

      // Match pattern: doc(anything, 'collectionName', anything)
      const regex2 = /doc\([^,]+,\s*['"]([a-zA-Z0-9_-]+)['"]\s*,/g;
      while ((match = regex2.exec(content)) !== null) {
        collections.add(match[1]);
      }
    }
  }
}

scanDir(srcDir);
console.log("Found collections:");
console.log(Array.from(collections).sort());
