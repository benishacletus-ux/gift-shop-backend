import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server } from 'socket.io';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const PORT = 5000;
const JWT_SECRET = 'gift-shop-secret-2024';

// Socket.io setup - UPDATED with Netlify URLs
const io = new Server(server, {
  cors: {
    origin: [
      'https://pinkbears-shop.netlify.app',        // Customer order page
      'https://pinkbears-adminpage.netlify.app',   // Admin page
      'http://localhost:3000', 
      'http://localhost:3001',
      'http://localhost:5173' // Vite dev server
    ],
    methods: ['GET', 'POST']
  }
});

// CORS configuration - UPDATED with Netlify URLs
app.use(cors({
  origin: [
    'https://pinkbears-shop.netlify.app',        // Customer order page
    'https://pinkbears-adminpage.netlify.app',   // Admin page  
    'http://localhost:3000', 
    'http://localhost:3001',
    'http://localhost:5173' // Vite dev server
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

app.use(express.json());

// Database setup
const dbPath = './giftshop.db';

// Initialize database
const initializeDatabase = () => {
  if (fs.existsSync(dbPath)) {
    console.log('🗑️  Deleting old database file to reset schema...');
    fs.unlinkSync(dbPath);
  }

  const db = new sqlite3.Database(dbPath);

  // Initialize tables
  db.serialize(() => {
    // Products table
    db.run(`CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      category TEXT NOT NULL,
      image TEXT,
      description TEXT,
      featured BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Messages table (for contact form)
    db.run(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Orders table - SIMPLIFIED for Cash on Delivery
    db.run(`CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      address_line1 TEXT NOT NULL,
      address_line2 TEXT,
      landmark TEXT,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      zip_code TEXT NOT NULL,
      country TEXT DEFAULT 'India',
      delivery_instructions TEXT,
      payment_method TEXT DEFAULT 'cash_on_delivery',
      payment_status TEXT DEFAULT 'pending',
      total REAL NOT NULL,
      items_json TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      tracking_number TEXT UNIQUE,
      estimated_delivery DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Order tracking history table
    db.run(`CREATE TABLE IF NOT EXISTS order_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      location TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders (id)
    )`);

    // Messages table for real-time chat
    db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      sender_type TEXT NOT NULL,
      sender_email TEXT,
      message TEXT NOT NULL,
      read_status BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders (id)
    )`);

    // Admins table
    db.run(`CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    )`);

    // Insert sample admin
    const adminPassword = bcrypt.hashSync('abijithbeni20', 10);
    db.run(`INSERT OR IGNORE INTO admins (username, password_hash) VALUES (?, ?)`, 
      ['pinkbearsadmin', adminPassword]);

    // Insert sample products with rupee prices
    const sampleProducts = [
      { name: 'Rose Gold Necklace', price: 4599, category: 'Jewelry', image: 'https://picsum.photos/300/300?random=1', description: 'Elegant rose gold necklace with crystal pendant', featured: 1 },
      { name: 'Lavender Scented Candle', price: 2499, category: 'Candles', image: 'https://picsum.photos/300/300?random=2', description: 'Hand-poured soy candle with lavender essence', featured: 1 },
      { name: 'Custom Photo Frame', price: 3250, category: 'Home Decor', image: 'https://picsum.photos/300/300?random=3', description: 'Personalized wooden photo frame', featured: 0 },
      { name: 'Artisan Notebook Set', price: 1899, category: 'Stationery', image: 'https://picsum.photos/300/300?random=4', description: 'Set of 3 handmade notebooks', featured: 1 },
      { name: 'Mini Succulent Garden', price: 2999, category: 'Plants', image: 'https://picsum.photos/300/300?random=5', description: 'Beautiful arrangement of small succulents', featured: 0 },
      { name: 'Birthday Gift Basket', price: 6500, category: 'Gift Sets', image: 'https://picsum.photos/300/300?random=6', description: 'Curated birthday surprise package', featured: 1 }
    ];

    // Clear existing products and insert new ones
    db.run('DELETE FROM products', (err) => {
      if (!err) {
        sampleProducts.forEach((product) => {
          db.run(`INSERT INTO products (name, price, category, image, description, featured) VALUES (?, ?, ?, ?, ?, ?)`,
            [product.name, product.price, product.category, product.image, product.description, product.featured]);
        });
        console.log('✅ Sample products inserted with rupee prices');
      }
    });
  });

  return db;
};

// Initialize database
const db = initializeDatabase();

// Socket.io for real-time features
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join_order', (orderId) => {
    socket.join(`order_${orderId}`);
  });

  socket.on('join_admin', () => {
    socket.join('admin_room');
  });

  socket.on('customer_join', (customerEmail) => {
    socket.join(`customer_${customerEmail}`);
  });

  // Real-time chat messages
  socket.on('send_message', (data) => {
    const { orderId, senderType, senderEmail, message } = data;
    
    db.run('INSERT INTO chat_messages (order_id, sender_type, sender_email, message) VALUES (?, ?, ?, ?)',
      [orderId, senderType, senderEmail, message], function(err) {
        if (err) return;

        const messageData = {
          id: this.lastID,
          orderId,
          senderType,
          senderEmail,
          message,
          timestamp: new Date()
        };

        // Real-time message broadcast
        io.to(`order_${orderId}`).emit('new_message', messageData);
        io.to('admin_room').emit('new_message', messageData);
      });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Helper functions
function generateTrackingNumber() {
  return 'PINKIES' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
}

function calculateEstimatedDelivery() {
  const deliveryDate = new Date();
  deliveryDate.setDate(deliveryDate.getDate() + 3 + Math.floor(Math.random() * 3));
  return deliveryDate.toISOString().split('T')[0];
}

// ✅ API Routes

app.get('/', (req, res) => {
  res.json({ message: '🎀 Pink Bears Gifts Backend is running! - Cash on Delivery Only' });
});

// Get all products
app.get('/api/products', (req, res) => {
  const { category, search } = req.query;
  let query = 'SELECT * FROM products WHERE 1=1';
  let params = [];

  if (category && category !== 'all') {
    query += ' AND category = ?';
    params.push(category);
  }

  if (search) {
    query += ' AND (name LIKE ? OR description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Get single product
app.get('/api/products/:id', (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM products WHERE id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(row);
  });
});

// Contact form
app.post('/api/contact', (req, res) => {
  const { name, email, message } = req.body;
  
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  db.run('INSERT INTO messages (name, email, message) VALUES (?, ?, ?)',
    [name, email, message], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: 'Message sent successfully!', id: this.lastID });
    });
});

// ✅ FIXED CHECKOUT - Corrected SQL INSERT statement
app.post('/api/checkout', async (req, res) => {
  const { 
    customer_name, 
    customer_email, 
    customer_phone,
    address_line1,
    address_line2,
    landmark,
    city,
    state,
    zip_code,
    country,
    delivery_instructions,
    total, 
    items 
  } = req.body;
  
  // Validate required fields
  if (!customer_name || !customer_email || !customer_phone || 
      !address_line1 || !city || !state || !zip_code) {
    return res.status(400).json({ error: 'Please fill all required fields' });
  }

  // Validate minimum order amount
  if (total < 1) {
    return res.status(400).json({ error: 'Order amount must be at least ₹1' });
  }

  const trackingNumber = generateTrackingNumber();
  const estimatedDelivery = calculateEstimatedDelivery();
  const itemsJson = JSON.stringify(items);
  const payment_method = 'cash_on_delivery';
  const payment_status = 'pending';

  console.log('💰 PROCESSING CASH ON DELIVERY ORDER:', {
    customer_name,
    customer_email,
    total: '₹' + total,
    payment_method: 'Cash on Delivery'
  });

  // ✅ FIXED: Correct INSERT statement - 17 columns, 17 values
  const insertQuery = `
    INSERT INTO orders (
      customer_name, customer_email, customer_phone,
      address_line1, address_line2, landmark, city, state, zip_code, country, 
      delivery_instructions, payment_method, payment_status, total, items_json, 
      tracking_number, estimated_delivery
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const insertValues = [
    customer_name, 
    customer_email, 
    customer_phone,
    address_line1, 
    address_line2 || '', 
    landmark || '', 
    city, 
    state, 
    zip_code, 
    country || 'India', 
    delivery_instructions || '',
    payment_method, 
    payment_status,
    total, 
    itemsJson, 
    trackingNumber, 
    estimatedDelivery
  ];

  db.run(insertQuery, insertValues, function(err) {
    if (err) {
      console.error('❌ Database error:', err);
      return res.status(500).json({ error: 'Failed to create order: ' + err.message });
    }
    
    const orderId = this.lastID;
    console.log(`✅ CASH ON DELIVERY ORDER CREATED! ID: ${orderId}, Total: ₹${total}`);
    
    // Add initial tracking history
    db.run('INSERT INTO order_tracking (order_id, status, message) VALUES (?, ?, ?)',
      [orderId, 'pending', 'Order received - Payment pending (Cash on Delivery)']);

    // Real-time notification
    io.emit('new_cod_order', {
      orderId,
      customer_name,
      customer_email,
      total: '₹' + total,
      trackingNumber,
      payment_method: 'Cash on Delivery',
      payment_status: 'pending',
      timestamp: new Date(),
      message: `💰 Cash on Delivery Order #${orderId} received!`
    });

    // Notify admin room
    io.to('admin_room').emit('new_cod_order_admin', {
      orderId,
      customer_name,
      customer_email,
      total: '₹' + total,
      trackingNumber,
      phone: customer_phone,
      address: `${address_line1}, ${city}, ${state} - ${zip_code}`,
      timestamp: new Date(),
      message: '💰 NEW CASH ON DELIVERY ORDER!'
    });

    res.json({ 
      success: true,
      message: 'Order placed successfully! Pay when you receive your order.', 
      orderId: orderId,
      trackingNumber: trackingNumber,
      total: total,
      estimatedDelivery: estimatedDelivery,
      payment_method: 'cash_on_delivery',
      payment_status: 'pending',
      currency: 'INR'
    });
  });
});

// Update payment status when COD order is delivered and paid
app.post('/api/orders/:id/confirm-payment', (req, res) => {
  const { id } = req.params;
  
  db.run('UPDATE orders SET payment_status = ? WHERE id = ?', 
    ['paid', id], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Add payment confirmation to tracking
      db.run('INSERT INTO order_tracking (order_id, status, message) VALUES (?, ?, ?)',
        [id, 'paid', 'Cash payment received upon delivery']);

      // Real-time notification
      io.emit('cod_payment_received', {
        orderId: id,
        timestamp: new Date(),
        message: '💰 Cash on Delivery payment received!'
      });

      res.json({ 
        success: true,
        message: 'Payment confirmed successfully' 
      });
    });
});

// Get order details
app.get('/api/orders/:id', (req, res) => {
  const { id } = req.params;
  
  db.get('SELECT * FROM orders WHERE id = ?', [id], (err, order) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    res.json({
      ...order,
      items: JSON.parse(order.items_json)
    });
  });
});

// Get payment status
app.get('/api/payment-status/:orderId', async (req, res) => {
  const { orderId } = req.params;
  
  db.get('SELECT payment_status, total FROM orders WHERE id = ?', [orderId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json({
      payment_status: row.payment_status,
      amount: row.total,
      payment_method: 'cash_on_delivery',
      currency: 'INR'
    });
  });
});

// Order tracking
app.get('/api/order-tracking/:trackingNumber', (req, res) => {
  const { trackingNumber } = req.params;
  
  db.get(`SELECT o.*, 
          (SELECT GROUP_CONCAT(ot.status || '|' || ot.message || '|' || ot.created_at, ';;') 
           FROM order_tracking ot 
           WHERE ot.order_id = o.id 
           ORDER BY ot.created_at DESC) as tracking_history
          FROM orders o WHERE o.tracking_number = ?`, [trackingNumber], (err, order) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    let trackingHistory = [];
    if (order.tracking_history) {
      trackingHistory = order.tracking_history.split(';;').map(entry => {
        const [status, message, timestamp] = entry.split('|');
        return { status, message, timestamp };
      });
    }

    res.json({
      ...order,
      trackingHistory,
      items: JSON.parse(order.items_json),
      currency: 'INR',
      payment_method: 'Cash on Delivery'
    });
  });
});

// Get chat messages for an order
app.get('/api/chat-messages/:orderId', (req, res) => {
  const { orderId } = req.params;
  
  db.all('SELECT * FROM chat_messages WHERE order_id = ? ORDER BY created_at ASC', 
    [orderId], (err, messages) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(messages);
    });
});

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;

  db.get('SELECT * FROM admins WHERE username = ?', [username], (err, admin) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, username: admin.username });
  });
});

// Middleware to verify admin token
const authenticateAdmin = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Access denied' });
  }

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.admin = verified;
    next();
  } catch (err) {
    res.status(400).json({ error: 'Invalid token' });
  }
};

// ✅ ADMIN ROUTES

// Get all orders for admin
app.get('/api/admin/orders', authenticateAdmin, (req, res) => {
  db.all('SELECT * FROM orders ORDER BY created_at DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Update order status
app.put('/api/admin/orders/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  db.get('SELECT * FROM orders WHERE id = ?', [id], (err, order) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    db.run('UPDATE orders SET status = ? WHERE id = ?', [status, id], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Add tracking history
      const statusMessages = {
        'pending': 'Order received - Payment pending (Cash on Delivery)',
        'confirmed': 'Order confirmed - Ready for delivery',
        'processing': 'Order is being prepared for shipment',
        'shipped': 'Order has been shipped - Collect payment on delivery',
        'out_for_delivery': 'Order is out for delivery - Collect payment',
        'delivered': 'Order has been delivered',
        'cancelled': 'Order has been cancelled'
      };

      const message = statusMessages[status] || `Order status updated to ${status}`;
      db.run('INSERT INTO order_tracking (order_id, status, message) VALUES (?, ?, ?)',
        [id, status, message]);

      // Real-time notification
      io.to(`order_${id}`).emit('order_updated', {
        orderId: id,
        status,
        message,
        timestamp: new Date()
      });

      io.to('admin_room').emit('orders_updated');

      res.json({ 
        message: 'Order status updated successfully'
      });
    });
  });
});

// ✅ ADDED: Admin analytics route
app.get('/api/admin/analytics', authenticateAdmin, (req, res) => {
  // Get total COD sales
  db.get('SELECT SUM(total) as totalSales, COUNT(*) as totalOrders FROM orders WHERE payment_status = "paid"', (err, salesRow) => {
    if (err) {
      console.error('Analytics error (sales):', err);
      return res.status(500).json({ error: err.message });
    }

    // Get pending COD payments
    db.get('SELECT SUM(total) as pendingAmount, COUNT(*) as pendingOrders FROM orders WHERE payment_status = "pending"', (err, pendingRow) => {
      if (err) {
        console.error('Analytics error (pending):', err);
        return res.status(500).json({ error: err.message });
      }

      // Get total orders count
      db.get('SELECT COUNT(*) as totalAllOrders FROM orders', (err, totalRow) => {
        if (err) {
          console.error('Analytics error (total):', err);
          return res.status(500).json({ error: err.message });
        }

        // Get recent orders (last 7 days)
        db.all(`
          SELECT * FROM orders 
          WHERE created_at >= datetime('now', '-7 days') 
          ORDER BY created_at DESC 
          LIMIT 10
        `, (err, recentOrders) => {
          if (err) {
            console.error('Analytics error (recent):', err);
            return res.status(500).json({ error: err.message });
          }

          // Get orders by status
          db.all(`
            SELECT status, COUNT(*) as count 
            FROM orders 
            GROUP BY status
          `, (err, statusRows) => {
            if (err) {
              console.error('Analytics error (status):', err);
              return res.status(500).json({ error: err.message });
            }

            // Get orders by category (simplified)
            db.all(`
              SELECT 'Jewelry' as category, COUNT(*) as count FROM orders o, json_each(o.items_json) items 
              WHERE json_extract(items.value, '$.category') = 'Jewelry'
              UNION ALL
              SELECT 'Candles' as category, COUNT(*) as count FROM orders o, json_each(o.items_json) items 
              WHERE json_extract(items.value, '$.category') = 'Candles'
              UNION ALL
              SELECT 'Home Decor' as category, COUNT(*) as count FROM orders o, json_each(o.items_json) items 
              WHERE json_extract(items.value, '$.category') = 'Home Decor'
              UNION ALL
              SELECT 'Stationery' as category, COUNT(*) as count FROM orders o, json_each(o.items_json) items 
              WHERE json_extract(items.value, '$.category') = 'Stationery'
              UNION ALL
              SELECT 'Plants' as category, COUNT(*) as count FROM orders o, json_each(o.items_json) items 
              WHERE json_extract(items.value, '$.category') = 'Plants'
              UNION ALL
              SELECT 'Gift Sets' as category, COUNT(*) as count FROM orders o, json_each(o.items_json) items 
              WHERE json_extract(items.value, '$.category') = 'Gift Sets'
            `, (err, categoryRows) => {
              if (err) {
                console.error('Analytics error (category):', err);
                categoryRows = [];
              }

              // Get top selling products (simplified)
              db.all(`
                SELECT p.id, p.name, SUM(json_extract(items.value, '$.quantity')) as total_sold
                FROM orders o, json_each(o.items_json) items
                JOIN products p ON p.id = json_extract(items.value, '$.id')
                GROUP BY p.id, p.name
                ORDER BY total_sold DESC
                LIMIT 5
              `, (err, topProducts) => {
                if (err) {
                  console.error('Analytics error (top products):', err);
                  topProducts = [];
                }

                res.json({
                  totalSales: salesRow.totalSales || 0,
                  totalOrders: salesRow.totalOrders || 0,
                  totalAllOrders: totalRow.totalAllOrders || 0,
                  pendingCollections: pendingRow.pendingAmount || 0,
                  pendingOrders: pendingRow.pendingOrders || 0,
                  currency: 'INR',
                  ordersByStatus: statusRows || [],
                  ordersByCategory: categoryRows || [],
                  topSellingProducts: topProducts || [],
                  recentOrders: recentOrders || [],
                  paymentMethod: 'Cash on Delivery Only',
                  success: true
                });
              });
            });
          });
        });
      });
    });
  });
});

// Product management routes
app.get('/api/admin/products', authenticateAdmin, (req, res) => {
  db.all('SELECT * FROM products ORDER BY created_at DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.post('/api/admin/products', authenticateAdmin, (req, res) => {
  const { name, price, category, image, description } = req.body;
  
  db.run('INSERT INTO products (name, price, category, image, description) VALUES (?, ?, ?, ?, ?)',
    [name, price, category, image, description], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: 'Product added successfully', id: this.lastID });
    });
});

app.put('/api/admin/products/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { name, price, category, image, description } = req.body;
  
  db.run('UPDATE products SET name = ?, price = ?, category = ?, image = ?, description = ? WHERE id = ?',
    [name, price, category, image, description, id], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: 'Product updated successfully' });
    });
});

app.delete('/api/admin/products/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  
  db.run('DELETE FROM products WHERE id = ?', [id], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: 'Product deleted successfully' });
  });
});

// Confirm COD payment received
app.post('/api/admin/orders/:id/confirm-payment', authenticateAdmin, (req, res) => {
  const { id } = req.params;

  db.run('UPDATE orders SET payment_status = ? WHERE id = ?', 
    ['paid', id], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Add payment confirmation to tracking
      db.run('INSERT INTO order_tracking (order_id, status, message) VALUES (?, ?, ?)',
        [id, 'paid', 'Cash payment received upon delivery - Order completed']);

      // Real-time notification
      io.emit('cod_payment_confirmed', {
        orderId: id,
        timestamp: new Date(),
        message: '💰 Cash on Delivery payment confirmed by admin!'
      });

      res.json({ 
        success: true,
        message: 'Cash payment confirmed successfully' 
      });
    });
});

server.listen(PORT, () => {
  console.log(`💰 PINK BEARS CASH ON DELIVERY BACKEND running on http://localhost:${PORT}`);
  console.log(`🌐 Backend URL: https://gift-shop-backend-yimq.onrender.com`);
  console.log(`🛒 Customer Frontend: https://pinkbears-shop.netlify.app`);
  console.log(`👑 Admin Frontend: https://pinkbears-adminpage.netlify.app`);
  console.log(`✅ PAYMENT METHOD: Cash on Delivery Only`);
  console.log(`✅ API endpoints are active`);
  console.log(`📦 Products endpoint: http://localhost:${PORT}/api/products`);
  console.log(`🛒 Checkout endpoint: http://localhost:${PORT}/api/checkout`);
  console.log(`📊 Analytics endpoint: http://localhost:${PORT}/api/admin/analytics`);
  console.log(`📦 Admin orders: http://localhost:${PORT}/api/admin/orders`);
  console.log(`🔔 Real-time order notifications enabled`);
  console.log(`💬 Real-time chat enabled`);
  console.log(`🏠 Database schema reset complete`);
  console.log(`🎯 READY FOR CASH ON DELIVERY ORDERS!`);
});
