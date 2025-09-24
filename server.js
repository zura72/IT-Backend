const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

// Konfigurasi Multer untuk file upload
const storage = multer.memoryStorage(); // Simpan file di memory
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

// Middleware - PERBAIKAN PENTING: Jangan gunakan express.json() untuk FormData
app.use(cors());
// Hanya gunakan urlencoded untuk form data, tidak perlu express.json() jika menerima FormData
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  console.log('Content-Type:', req.get('Content-Type'));
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

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Stok Helpdesk API running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🎫 Tickets endpoint: http://localhost:${PORT}/api/tickets`);
});

// Generate unique ticket ID
function generateTicketId() {
  return `TKT-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
}

// Routes

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Stok Helpdesk API is running',
    timestamp: new Date().toISOString()
  });
});

// Get all tickets dengan filter status
app.get('/api/tickets', async (req, res) => {
  try {
    const { status, page = 1, limit = 100 } = req.query;
    
    let filteredTickets = tickets;
    if (status) {
      filteredTickets = tickets.filter(ticket => ticket.status === status);
    }
    
    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedTickets = filteredTickets.slice(startIndex, endIndex);
    
    res.json({
      rows: paginatedTickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
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

// PERBAIKAN BESAR: Create new ticket dengan Multer middleware
app.post('/api/tickets', upload.single('photo'), async (req, res) => {
  try {
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    console.log('File:', req.file);

    // Ambil data dari body (FormData)
    const {
      name,
      division,
      priority,
      description
    } = req.body;

    // Debug: Log data yang diterima
    console.log('Received data:', {
      name,
      division,
      priority,
      description,
      hasPhoto: !!req.file
    });

    // Validation - PERBAIKAN: Handle case-sensitive field names
    if (!name || !division || !description) {
      return res.status(400).json({ 
        error: 'Missing required fields: name, division, description',
        received: { name, division, description }
      });
    }

    // Handle photo jika ada
    let photoData = '';
    if (req.file) {
      // Convert buffer to base64
      photoData = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    }

    const newTicket = {
      _id: `ticket_${Date.now()}_${ticketCounter++}`,
      ticketNo: generateTicketId(),
      name: name.trim(),
      division: division.trim(),
      priority: priority || (division.toLowerCase().includes('bod (urgent)') ? 'Urgent' : 'Normal'),
      description: description.trim(),
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