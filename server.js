const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

// Konfigurasi Multer untuk file upload
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // Turunkan menjadi 5MB untuk hemat memory
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file gambar yang diizinkan'), false);
    }
  }
});

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

// Jalankan cleanup setiap 24 jam
setInterval(cleanupOldTickets, 24 * 60 * 60 * 1000);

// Middleware - PERBAIKAN: Gunakan express.json() dengan limit yang sesuai
app.use(cors());
app.use(express.json({ limit: '5mb' })); // Turunkan limit
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Simple logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Helper untuk menangani FormData parsing errors
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File terlalu besar. Maksimal 5MB' });
    }
  }
  next(error);
});

// Generate unique ticket ID
function generateTicketId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 4);
  return `TKT-${timestamp}-${random}`.toUpperCase();
}

// Routes

// Root endpoint - sederhana dan cepat
app.get('/', (req, res) => {
  res.json({ 
    message: 'Stok Helpdesk API is running',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Health check endpoint - sangat sederhana dan cepat
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
  });
});

// Simple health check untuk Docker (text plain)
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Get all tickets dengan filter status
app.get('/api/tickets', async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query; // Turunkan default limit
    
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
    
    // Hapus photo data untuk response yang lebih kecil
    const { photo, ...ticketWithoutPhoto } = ticket;
    res.json(ticketWithoutPhoto);
  } catch (error) {
    console.error('Error fetching ticket:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new ticket dengan Multer middleware
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

    // Handle photo jika ada - kompres jika perlu
    let photoData = '';
    if (req.file) {
      // Gunakan buffer langsung tanpa konversi base64 untuk hemat memory
      photoData = {
        data: req.file.buffer.toString('base64'),
        contentType: req.file.mimetype,
        size: req.file.size
      };
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
      photo: photoData,
      notes: '',
      operator: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    tickets.push(newTicket);

    console.log('New ticket created:', newTicket.ticketNo);
    
    // Response tanpa photo data untuk hemat bandwidth
    const { photo: _, ...responseTicket } = newTicket;
    
    res.status(201).json({
      message: 'Ticket created successfully',
      ticket: responseTicket,
      ticketId: newTicket._id
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

// Delete ticket
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

    res.json({
      message: 'Ticket deleted successfully',
      ticket: deletedTicket
    });

  } catch (error) {
    console.error('Error deleting ticket:', error);
    res.status(500).json({ error: 'Failed to delete ticket' });
  }
});

// Dashboard statistics - sederhana
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
    if (!portAvailable) {
      console.error(`Port ${PORT} is already in use`);
      process.exit(1);
    }

    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Stok Helpdesk API running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
      console.log(`🎫 Tickets endpoint: http://localhost:${PORT}/api/tickets`);
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