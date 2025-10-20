const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure base uploads directory exists
const baseUploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(baseUploadsDir)) {
  fs.mkdirSync(baseUploadsDir, { recursive: true });
}

function sanitizeSegment(segment) {
  return segment
    .trim()
    .replace(/[\\/]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/[^\w\-\.]/g, '')
    .slice(0, 80);
}

// Multer storage configured dynamically per request
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const classNameRaw = req.body.className || '';
    const personNameRaw = req.body.personName || '';

    const className = sanitizeSegment(classNameRaw);
    const personName = sanitizeSegment(personNameRaw);

    if (!className || !personName) {
      return cb(new Error('className and personName are required'));
    }

    const dirName = `${className}_${personName}`;
    const fullPath = path.join(baseUploadsDir, dirName);
    fs.mkdirSync(fullPath, { recursive: true });
    cb(null, fullPath);
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname) || '';
    const base = path.basename(file.originalname, ext).slice(0, 60);
    const safeBase = sanitizeSegment(base) || 'file';
    cb(null, `${timestamp}_${safeBase}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per file
    files: 10,
  },
});

// Data persistence: simple JSON index per person folder
function readFolderIndex(folderPath) {
  const indexPath = path.join(folderPath, 'index.json');
  if (!fs.existsSync(indexPath)) return { items: [] };
  try {
    const content = fs.readFileSync(indexPath, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    return { items: [] };
  }
}

function writeFolderIndex(folderPath, data) {
  const indexPath = path.join(folderPath, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(data, null, 2), 'utf-8');
}

// Upload endpoint
app.post('/api/upload', upload.array('files', 10), (req, res) => {
  try {
    const { className, personName, description } = req.body;
    if (!className || !personName) {
      return res.status(400).json({ error: 'className and personName are required' });
    }
    const folderName = `${sanitizeSegment(className)}_${sanitizeSegment(personName)}`;
    const folderPath = path.join(baseUploadsDir, folderName);

    const files = req.files || [];
    const createdAt = Date.now();
    const items = files.map((f) => ({
      type: f.mimetype.startsWith('video') ? 'video' : 'image',
      filename: path.basename(f.path),
      url: `/uploads/${folderName}/${path.basename(f.path)}`,
      uploadedAt: createdAt,
      description: description || '',
      className,
      personName,
    }));

    const indexData = readFolderIndex(folderPath);
    indexData.items.push(...items);
    writeFolderIndex(folderPath, indexData);

    return res.json({ success: true, items });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Upload failed' });
  }
});

// List all items across folders, sorted by time desc
app.get('/api/items', (req, res) => {
  try {
    const folders = fs.readdirSync(baseUploadsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    let all = [];
    for (const dirent of folders) {
      const folderPath = path.join(baseUploadsDir, dirent.name);
      const indexData = readFolderIndex(folderPath);
      // add folderName for URL
      for (const item of indexData.items) {
        all.push({ ...item, folderName: dirent.name });
      }
    }

    all.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));

    return res.json({ items: all });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to read items' });
  }
});

// Home route serves static index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Upload page
app.get('/upload', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
