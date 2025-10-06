const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

const app = express();

// ✅ FIX untuk Railway: Gunakan PORT dari environment
const PORT = process.env.PORT || 4000;

// ✅ FIX untuk Railway: File storage directory
const uploadsDir = process.env.NODE_ENV === 'production' 
  ? '/tmp/uploads'  // Railway prefer temporary directory
  : path.join(__dirname, 'uploads');

// ✅ PERBAIKAN UTAMA: Konfigurasi CORS yang benar
const allowedOrigins = [
  'http://localhost:8080',                 // dev frontend
  'http://localhost:3000',                 // alternative dev port
  'https://it-helpdesk-stok.netlify.app',  // production frontend
];

// Auto-allow Railway preview domains
if (process.env.RAILWAY_STATIC_URL) {
  allowedOrigins.push(process.env.RAILWAY_STATIC_URL);
}
if (process.env.RAILWAY_PUBLIC_DOMAIN) {
  allowedOrigins.push(`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
}

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, postman)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      // Allow Railway preview domains dynamically
      if (origin.includes('.railway.app')) {
        callback(null, true);
      } else {
        console.log('CORS blocked for origin:', origin);
        callback(new Error('CORS not allowed for this origin'));
      }
    }
  },
  credentials: true, // ✅ Izinkan credentials (cookies, authorization)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  optionsSuccessStatus: 200
};

// Terapkan CORS middleware
app.use(cors(corsOptions));

// ✅ Handle preflight requests untuk semua routes
app.options('*', cors(corsOptions));

// ✅ PERBAIKAN BESAR: Konfigurasi Multer untuk file storage (DISK STORAGE)
// Buat folder uploads jika belum ada
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 Created uploads directory:', uploadsDir);
}

// Konfigurasi disk storage untuk menyimpan file fisik
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir); // folder uploads
  },
  filename: (req, file, cb) => {
    // Generate nama file unik
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const fileExtension = path.extname(file.originalname);
    const fileName = 'img-' + uniqueSuffix + fileExtension;
    cb(null, fileName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file gambar yang diizinkan'), false);
    }
  }
});

// ✅ Serve static files dari folder uploads
app.use('/uploads', express.static(uploadsDir));

// In-memory storage dengan periodic cleanup
let tickets = [];
let ticketCounter = 1;

// Cleanup tickets yang sudah lama (prevent memory leak)
function cleanupOldTickets() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
  
  tickets = tickets.filter(ticket => {
    const ticketDate = new Date(ticket.createdAt);
    return ticketDate > thirtyDaysAgo;
  });
  
  console.log(`Cleanup completed. Total tickets: ${tickets.length}`);
}

// Cleanup file uploads yang sudah lama
function cleanupOldFiles() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
  
  fs.readdir(uploadsDir, (err, files) => {
    if (err) {
      console.error('Error reading uploads directory:', err);
      return;
    }
    
    files.forEach(file => {
      const filePath = path.join(uploadsDir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        
        if (stats.mtime < sevenDaysAgo) {
          fs.unlink(filePath, err => {
            if (!err) {
              console.log(`🗑️ Deleted old file: ${file}`);
            }
          });
        }
      });
    });
  });
}

// Jalankan cleanup setiap 24 jam
setInterval(cleanupOldTickets, 24 * 60 * 60 * 1000);
setInterval(cleanupOldFiles, 24 * 60 * 60 * 1000);

// Middleware lainnya
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Simple logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - Origin: ${req.headers.origin || 'none'}`);
  next();
});

// Helper untuk menangani FormData parsing errors
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File terlalu besar. Maksimal 5MB' });
    }
  }
  
  // Handle CORS errors
  if (error.message.includes('CORS')) {
    return res.status(403).json({ 
      error: 'CORS Error',
      message: error.message,
      allowedOrigins: allowedOrigins
    });
  }
  
  next(error);
});

// Generate unique ticket ID
function generateTicketId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 4);
  return `TKT-${timestamp}-${random}`.toUpperCase();
}

// Helper untuk mendapatkan base URL
function getBaseUrl(req) {
  if (process.env.NODE_ENV === 'production') {
    return `https://${req.get('host')}`;
  }
  return `${req.protocol}://${req.get('host')}`;
}

// Routes

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Stok Helpdesk API is running',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    port: PORT,
    cors: 'configured for credentials',
    fileStorage: 'disk storage enabled',
    uploads: '/uploads endpoint available',
    uploadsDir: uploadsDir,
    allowedOrigins: allowedOrigins
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    environment: process.env.NODE_ENV || 'development',
    cors: {
      configured: true,
      credentials: true,
      allowedOrigins: allowedOrigins
    },
    storage: {
      type: 'disk',
      uploadsDir: uploadsDir,
      files: fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir).length : 0
    },
    railway: {
      publicDomain: process.env.RAILWAY_PUBLIC_DOMAIN || 'not set',
      staticUrl: process.env.RAILWAY_STATIC_URL || 'not set'
    }
  });
});

// Simple health check untuk Docker (text plain)
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Get all tickets dengan filter status
app.get('/api/tickets', async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    
    let filteredTickets = tickets;
    if (status && status !== 'all') {
      filteredTickets = tickets.filter(ticket => ticket.status === status);
    }
    
    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedTickets = filteredTickets
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(startIndex, endIndex);
    
    res.json({
      rows: paginatedTickets,
      totalPages: Math.ceil(filteredTickets.length / limit),
      currentPage: parseInt(page),
      total: filteredTickets.length
    });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get ticket by ID
app.get('/api/tickets/:id', async (req, res) => {
  try {
    const ticket = tickets.find(t => 
      t._id === req.params.id || t.ticketNo === req.params.id
    );
    
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    
    res.json(ticket);
  } catch (error) {
    console.error('Error fetching ticket:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ PERBAIKAN BESAR: Create new ticket dengan file storage
app.post('/api/tickets', upload.single('photo'), async (req, res) => {
  try {
    // Ambil data dari body (FormData atau JSON)
    const {
      name,
      division,
      priority,
      description
    } = req.body;

    // Validation
    if (!name || !division || !description) {
      return res.status(400).json({ 
        error: 'Missing required fields: name, division, description'
      });
    }

    // ✅ PERBAIKAN: Handle photo URL alih-alih base64
    let photoUrl = '';
    if (req.file) {
      // Simpan path relatif, frontend akan construct full URL
      photoUrl = `/uploads/${req.file.filename}`;
      console.log('File saved:', photoUrl, 'Size:', req.file.size, 'bytes');
    }

    const newTicket = {
      _id: `ticket_${Date.now()}_${ticketCounter++}`,
      ticketNo: generateTicketId(),
      name: String(name).trim(),
      division: String(division).trim(),
      priority: priority || 'Normal',
      description: String(description).trim(),
      status: 'Belum',
      assignee: '',
      photo: photoUrl, // ✅ SEKARANG STRING URL, BUKAN OBJECT
      notes: '',
      operator: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    tickets.push(newTicket);

    console.log('New ticket created:', newTicket.ticketNo, 'Photo:', photoUrl || 'No photo');
    
    res.status(201).json({
      message: 'Ticket created successfully',
      ticket: newTicket,
      ticketId: newTicket._id,
      ticketNo: newTicket.ticketNo
    });

  } catch (error) {
    console.error('Error creating ticket:', error);
    res.status(500).json({ error: 'Failed to create ticket: ' + error.message });
  }
});

// Update ticket status
app.put('/api/tickets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, operator } = req.body;

    const ticketIndex = tickets.findIndex(t => 
      t._id === id || t.ticketNo === id
    );

    if (ticketIndex === -1) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    tickets[ticketIndex] = {
      ...tickets[ticketIndex],
      status: status || tickets[ticketIndex].status,
      notes: notes || tickets[ticketIndex].notes,
      operator: operator || tickets[ticketIndex].operator,
      updatedAt: new Date().toISOString()
    };

    res.json({
      message: 'Ticket updated successfully',
      ticket: tickets[ticketIndex]
    });

  } catch (error) {
    console.error('Error updating ticket:', error);
    res.status(500).json({ error: 'Failed to update ticket' });
  }
});

// Update ticket status to resolved
app.post('/api/tickets/:id/resolve', async (req, res) => {
  try {
    const { id } = req.params;
    const { notes, operator } = req.body;

    const ticketIndex = tickets.findIndex(t => 
      t._id === id || t.ticketNo === id
    );

    if (ticketIndex === -1) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    tickets[ticketIndex] = {
      ...tickets[ticketIndex],
      status: 'Selesai',
      notes: notes || tickets[ticketIndex].notes,
      operator: operator || tickets[ticketIndex].operator,
      updatedAt: new Date().toISOString()
    };

    res.json({
      message: 'Ticket resolved successfully',
      ticket: tickets[ticketIndex]
    });

  } catch (error) {
    console.error('Error resolving ticket:', error);
    res.status(500).json({ error: 'Failed to resolve ticket' });
  }
});

// Update ticket status to declined
app.post('/api/tickets/:id/decline', async (req, res) => {
  try {
    const { id } = req.params;
    const { notes, operator } = req.body;

    const ticketIndex = tickets.findIndex(t => 
      t._id === id || t.ticketNo === id
    );

    if (ticketIndex === -1) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    tickets[ticketIndex] = {
      ...tickets[ticketIndex],
      status: 'Ditolak',
      notes: notes || tickets[ticketIndex].notes,
      operator: operator || tickets[ticketIndex].operator,
      updatedAt: new Date().toISOString()
    };

    res.json({
      message: 'Ticket declined successfully',
      ticket: tickets[ticketIndex]
    });

  } catch (error) {
    console.error('Error declining ticket:', error);
    res.status(500).json({ error: 'Failed to decline ticket' });
  }
});

// Delete ticket - Juga hapus file photo jika ada
app.delete('/api/tickets/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const ticketIndex = tickets.findIndex(t => 
      t._id === id || t.ticketNo === id
    );

    if (ticketIndex === -1) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const deletedTicket = tickets.splice(ticketIndex, 1)[0];

    // Hapus file photo jika ada
    if (deletedTicket.photo && deletedTicket.photo.startsWith('/uploads/')) {
      const filePath = path.join(uploadsDir, deletedTicket.photo.replace('/uploads/', ''));
      fs.unlink(filePath, (err) => {
        if (!err) {
          console.log('🗑️ Deleted photo file:', deletedTicket.photo);
        }
      });
    }

    res.json({
      message: 'Ticket deleted successfully',
      ticket: deletedTicket
    });

  } catch (error) {
    console.error('Error deleting ticket:', error);
    res.status(500).json({ error: 'Failed to delete ticket' });
  }
});

// Dashboard statistics
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const totalTickets = tickets.length;
    const belumTickets = tickets.filter(t => t.status === 'Belum').length;
    const prosesTickets = tickets.filter(t => t.status === 'Proses').length;
    const selesaiTickets = tickets.filter(t => t.status === 'Selesai').length;
    const ditolakTickets = tickets.filter(t => t.status === 'Ditolak').length;

    res.json({
      totalTickets,
      belumTickets,
      prosesTickets,
      selesaiTickets,
      ditolakTickets
    });

  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  
  // Handle CORS errors specifically
  if (error.message.includes('CORS')) {
    return res.status(403).json({ 
      error: 'CORS Error',
      message: error.message,
      allowedOrigins: allowedOrigins
    });
  }
  
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// PERBAIKAN: Startup check yang lebih cepat
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const net = require('net');
    const server = net.createServer();
    server.listen(port, '0.0.0.0');
    server.on('error', () => resolve(false));
    server.on('listening', () => {
      server.close();
      resolve(true);
    });
  });
}

// Start server dengan error handling
async function startServer() {
  try {
    // Check jika port available
    const portAvailable = await isPortAvailable(PORT);
    if (!portAvailable && process.env.NODE_ENV !== 'production') {
      console.error(`Port ${PORT} is already in use`);
      process.exit(1);
    }

    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Stok Helpdesk API running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
      console.log(`🎫 Tickets endpoint: http://localhost:${PORT}/api/tickets`);
      console.log(`🖼️  File uploads: http://localhost:${PORT}/uploads/`);
      console.log(`📁 Uploads directory: ${uploadsDir}`);
      console.log(`🔧 CORS configured for:`, allowedOrigins);
      console.log(`🔐 Credentials: ALLOWED`);
      console.log(`💾 Storage: DISK STORAGE`);
      console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🚂 Railway: ${process.env.RAILWAY_PUBLIC_DOMAIN || 'Not detected'}`);
      console.log(`💾 Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
    });

    // Graceful shutdown
    const gracefulShutdown = (signal) => {
      console.log(`\nReceived ${signal}, shutting down gracefully...`);
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });

      // Force shutdown setelah 5 detik
      setTimeout(() => {
        console.error('Forcing shutdown after timeout');
        process.exit(1);
      }, 5000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      process.exit(1);
    });

    server.on('error', (error) => {
      console.error('Server error:', error);
      process.exit(1);
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Jalankan server
startServer();