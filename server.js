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
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file gambar yang diizinkan'), false);
    }
  }
});

// In-memory storage
let tickets = [];
let ticketCounter = 1;

// Middleware - PERBAIKAN: Gunakan express.json() dengan limit yang sesuai
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Helper untuk menangani FormData parsing errors
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File terlalu besar. Maksimal 10MB' });
    }
  }
  next(error);
});

// Generate unique ticket ID
function generateTicketId() {
  return `TKT-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
}

// Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'Stok Helpdesk API is running',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Stok Helpdesk API is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Get all tickets dengan filter status
app.get('/api/tickets', async (req, res) => {
  try {
    const { status, page = 1, limit = 100 } = req.query;
    
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
        error: 'Missing required fields: name, division, description',
        received: { name, division, description }
      });
    }

    // Handle photo jika ada
    let photoData = '';
    if (req.file) {
      photoData = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    }

    const newTicket = {
      _id: `ticket_${Date.now()}_${ticketCounter++}`,
      ticketNo: generateTicketId(),
      name: name.toString().trim(),
      division: division.toString().trim(),
      priority: priority || 'Normal',
      description: description.toString().trim(),
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
    
    res.status(201).json({
      message: 'Ticket created successfully',
      ticket: newTicket,
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

// Dashboard statistics
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const totalTickets = tickets.length;
    const belumTickets = tickets.filter(t => t.status === 'Belum').length;
    const prosesTickets = tickets.filter(t => t.status === 'Proses').length;
    const selesaiTickets = tickets.filter(t => t.status === 'Selesai').length;
    const ditolakTickets = tickets.filter(t => t.status === 'Ditolak').length;

    // Tickets by priority
    const priorityStats = {};
    tickets.forEach(ticket => {
      priorityStats[ticket.priority] = (priorityStats[ticket.priority] || 0) + 1;
    });

    res.json({
      totalTickets,
      belumTickets,
      prosesTickets,
      selesaiTickets,
      ditolakTickets,
      priorityStats: Object.entries(priorityStats).map(([priority, count]) => ({
        _id: priority,
        count
      }))
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

// PERBAIKAN PENTING: Handle process shutdown gracefully
process.on('SIGTERM', () => {
  console.log('Received SIGTERM signal, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Received SIGINT signal, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start server dengan error handling
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Stok Helpdesk API running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🎫 Tickets endpoint: http://localhost:${PORT}/api/tickets`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
    process.exit(1);
  } else {
    console.error('Server error:', error);
    process.exit(1);
  }
});