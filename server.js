const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============= DATABASE SETUP - FIXED (with directory creation) =============
const fs = require('fs');

// Ensure /data directory exists on Render
if (process.env.RENDER) {
  const dataDir = '/data';
  if (!fs.existsSync(dataDir)) {
    console.log(`📁 Creating ${dataDir} directory...`);
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

const DB_PATH = process.env.RENDER ? '/data/pcg_church.db' : './pcg_church.db';
console.log(`📁 Database path: ${DB_PATH}`);

// Open database with error handling
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error(`❌ Database error: ${err.message}`);
    if (err.code === 'SQLITE_CANTOPEN') {
      console.error(`❌ Cannot open/create database at ${DB_PATH}`);
      console.error(`💡 Check disk mount configuration in render.yaml`);
      process.exit(1);
    }
  } else {
    console.log(`✅ Database connected successfully`);
  }
});

// ============= RATE LIMITING =============
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 300,
  skipSuccessfulRequests: false,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment before trying again.' }
});

const readLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 600,
  skipSuccessfulRequests: false,
  message: { error: 'Too many read requests. Please slow down.' }
});

// Apply different limits based on HTTP method
app.use('/api/', (req, res, next) => {
  if (req.method === 'GET') {
    return readLimiter(req, res, next);
  }
  return limiter(req, res, next);
});

// ============= INITIALIZE DATABASE TABLES =============
db.serialize(() => {
  // Junior Youth members table (ages 12-18)
  db.run(`
    CREATE TABLE IF NOT EXISTS junior_youth (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      age INTEGER NOT NULL,
      gender TEXT,
      date_of_birth TEXT,
      parent_name TEXT,
      parent_phone TEXT,
      parent_email TEXT,
      address TEXT,
      school_name TEXT,
      class_level TEXT,
      medical_conditions TEXT,
      emergency_contact TEXT,
      emergency_phone TEXT,
      baptism_status TEXT,
      baptism_date TEXT,
      join_date TEXT,
      attendance_count INTEGER DEFAULT 0,
      profile_image TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Children Service members table (ages 3-11)
  db.run(`
    CREATE TABLE IF NOT EXISTS children_service (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      age INTEGER NOT NULL,
      gender TEXT,
      date_of_birth TEXT,
      parent_name TEXT,
      parent_phone TEXT,
      parent_email TEXT,
      address TEXT,
      school_name TEXT,
      class_level TEXT,
      allergies TEXT,
      medical_conditions TEXT,
      emergency_contact TEXT,
      emergency_phone TEXT,
      baptism_status TEXT,
      baptism_date TEXT,
      join_date TEXT,
      attendance_count INTEGER DEFAULT 0,
      profile_image TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Leaders table
  db.run(`
    CREATE TABLE IF NOT EXISTS leaders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      role TEXT NOT NULL,
      department TEXT,
      responsibility TEXT,
      join_date TEXT,
      qualifications TEXT,
      is_active INTEGER DEFAULT 1,
      profile_image TEXT,
      password_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Attendance tracking table
  db.run(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_type TEXT NOT NULL,
      member_id INTEGER NOT NULL,
      service_date TEXT NOT NULL,
      service_type TEXT,
      present INTEGER DEFAULT 1,
      notes TEXT,
      recorded_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Events table
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      event_date TEXT,
      event_type TEXT,
      location TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insert default admin leader
  db.get("SELECT * FROM leaders WHERE email = 'admin@pcg.org'", (err, row) => {
    if (err) {
      console.error("Error checking for admin:", err.message);
      return;
    }
    if (!row) {
      const defaultPassword = bcrypt.hashSync('admin123', 10);
      db.run(`
        INSERT INTO leaders (full_name, email, phone, role, department, responsibility, join_date, password_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, ['Church Administrator', 'admin@pcg.org', '+233 20 000 0000', 'Administrator', 'Church Leadership', 'System Administration', '2024-01-01', defaultPassword], (err) => {
        if (err) console.error("Error creating admin:", err.message);
        else console.log("✅ Default admin user created");
      });
    } else {
      console.log("✅ Admin user already exists");
    }
  });
});

// ============= HELPER FUNCTIONS FOR VALIDATION =============

const validateJuniorYouthAge = (age) => {
  const ageNum = parseInt(age);
  if (isNaN(ageNum)) return { valid: false, message: 'Age must be a valid number' };
  if (ageNum < 12 || ageNum > 18) {
    return { valid: false, message: 'Junior Youth members must be between 12 and 18 years old' };
  }
  return { valid: true };
};

const validateChildrenAge = (age) => {
  const ageNum = parseInt(age);
  if (isNaN(ageNum)) return { valid: false, message: 'Age must be a valid number' };
  if (ageNum < 3 || ageNum > 11) {
    return { valid: false, message: 'Children Service members must be between 3 and 11 years old' };
  }
  return { valid: true };
};

const validateRequiredFields = (data, requiredFields) => {
  for (const field of requiredFields) {
    if (!data[field] || data[field].toString().trim() === '') {
      return { valid: false, message: `${field} is required` };
    }
  }
  return { valid: true };
};

// ============= API ROUTES =============

// Junior Youth endpoints
app.get('/api/junior-youth', (req, res) => {
  db.all("SELECT * FROM junior_youth ORDER BY full_name", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/junior-youth/:id', (req, res) => {
  db.get("SELECT * FROM junior_youth WHERE id = ?", [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Member not found' });
    res.json(row);
  });
});

app.post('/api/junior-youth', (req, res) => {
  const requiredCheck = validateRequiredFields(req.body, ['full_name', 'age']);
  if (!requiredCheck.valid) {
    return res.status(400).json({ error: requiredCheck.message });
  }
  
  const ageValidation = validateJuniorYouthAge(req.body.age);
  if (!ageValidation.valid) {
    return res.status(400).json({ error: ageValidation.message });
  }
  
  const { full_name, age, gender, date_of_birth, parent_name, parent_phone, parent_email, address, school_name, class_level, medical_conditions, emergency_contact, emergency_phone, baptism_status, baptism_date, join_date } = req.body;
  
  db.run(`
    INSERT INTO junior_youth (full_name, age, gender, date_of_birth, parent_name, parent_phone, parent_email, address, school_name, class_level, medical_conditions, emergency_contact, emergency_phone, baptism_status, baptism_date, join_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [full_name, age, gender, date_of_birth, parent_name, parent_phone, parent_email, address, school_name, class_level, medical_conditions, emergency_contact, emergency_phone, baptism_status, baptism_date, join_date || new Date().toISOString().split('T')[0]],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, message: 'Junior youth member added successfully' });
    }
  );
});

app.put('/api/junior-youth/:id', (req, res) => {
  const requiredCheck = validateRequiredFields(req.body, ['full_name', 'age']);
  if (!requiredCheck.valid) {
    return res.status(400).json({ error: requiredCheck.message });
  }
  
  const ageValidation = validateJuniorYouthAge(req.body.age);
  if (!ageValidation.valid) {
    return res.status(400).json({ error: ageValidation.message });
  }
  
  const { full_name, age, gender, date_of_birth, parent_name, parent_phone, parent_email, address, school_name, class_level, medical_conditions, emergency_contact, emergency_phone, baptism_status, baptism_date, join_date, attendance_count } = req.body;
  
  db.run(`
    UPDATE junior_youth SET 
      full_name = ?, age = ?, gender = ?, date_of_birth = ?, parent_name = ?, parent_phone = ?, parent_email = ?,
      address = ?, school_name = ?, class_level = ?, medical_conditions = ?, emergency_contact = ?, emergency_phone = ?,
      baptism_status = ?, baptism_date = ?, join_date = ?, attendance_count = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [full_name, age, gender, date_of_birth, parent_name, parent_phone, parent_email, address, school_name, class_level, medical_conditions, emergency_contact, emergency_phone, baptism_status, baptism_date, join_date, attendance_count, req.params.id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Junior youth member updated successfully' });
    }
  );
});

app.delete('/api/junior-youth/:id', (req, res) => {
  db.run("DELETE FROM junior_youth WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Member deleted successfully' });
  });
});

// Children Service endpoints
app.get('/api/children', (req, res) => {
  db.all("SELECT * FROM children_service ORDER BY full_name", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/children/:id', (req, res) => {
  db.get("SELECT * FROM children_service WHERE id = ?", [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Child not found' });
    res.json(row);
  });
});

app.post('/api/children', (req, res) => {
  const requiredCheck = validateRequiredFields(req.body, ['full_name', 'age']);
  if (!requiredCheck.valid) {
    return res.status(400).json({ error: requiredCheck.message });
  }
  
  const ageValidation = validateChildrenAge(req.body.age);
  if (!ageValidation.valid) {
    return res.status(400).json({ error: ageValidation.message });
  }
  
  const { full_name, age, gender, date_of_birth, parent_name, parent_phone, parent_email, address, school_name, class_level, allergies, medical_conditions, emergency_contact, emergency_phone, baptism_status, baptism_date, join_date } = req.body;
  
  db.run(`
    INSERT INTO children_service (full_name, age, gender, date_of_birth, parent_name, parent_phone, parent_email, address, school_name, class_level, allergies, medical_conditions, emergency_contact, emergency_phone, baptism_status, baptism_date, join_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [full_name, age, gender, date_of_birth, parent_name, parent_phone, parent_email, address, school_name, class_level, allergies, medical_conditions, emergency_contact, emergency_phone, baptism_status, baptism_date, join_date || new Date().toISOString().split('T')[0]],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, message: 'Child member added successfully' });
    }
  );
});

app.put('/api/children/:id', (req, res) => {
  const requiredCheck = validateRequiredFields(req.body, ['full_name', 'age']);
  if (!requiredCheck.valid) {
    return res.status(400).json({ error: requiredCheck.message });
  }
  
  const ageValidation = validateChildrenAge(req.body.age);
  if (!ageValidation.valid) {
    return res.status(400).json({ error: ageValidation.message });
  }
  
  const { full_name, age, gender, date_of_birth, parent_name, parent_phone, parent_email, address, school_name, class_level, allergies, medical_conditions, emergency_contact, emergency_phone, baptism_status, baptism_date, join_date, attendance_count } = req.body;
  
  db.run(`
    UPDATE children_service SET 
      full_name = ?, age = ?, gender = ?, date_of_birth = ?, parent_name = ?, parent_phone = ?, parent_email = ?,
      address = ?, school_name = ?, class_level = ?, allergies = ?, medical_conditions = ?, emergency_contact = ?,
      emergency_phone = ?, baptism_status = ?, baptism_date = ?, join_date = ?, attendance_count = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [full_name, age, gender, date_of_birth, parent_name, parent_phone, parent_email, address, school_name, class_level, allergies, medical_conditions, emergency_contact, emergency_phone, baptism_status, baptism_date, join_date, attendance_count, req.params.id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Child member updated successfully' });
    }
  );
});

app.delete('/api/children/:id', (req, res) => {
  db.run("DELETE FROM children_service WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Child deleted successfully' });
  });
});

// Leaders endpoints
app.get('/api/leaders', (req, res) => {
  db.all("SELECT id, full_name, email, phone, role, department, responsibility, join_date, qualifications, is_active, profile_image, created_at FROM leaders ORDER BY full_name", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/leaders', (req, res) => {
  const requiredCheck = validateRequiredFields(req.body, ['full_name', 'email', 'role']);
  if (!requiredCheck.valid) {
    return res.status(400).json({ error: requiredCheck.message });
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(req.body.email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  
  const { full_name, email, phone, role, department, responsibility, join_date, qualifications, password } = req.body;
  const password_hash = password ? bcrypt.hashSync(password, 10) : null;
  
  db.run(`
    INSERT INTO leaders (full_name, email, phone, role, department, responsibility, join_date, qualifications, password_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [full_name, email, phone, role, department, responsibility, join_date, qualifications, password_hash],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(409).json({ error: 'Email already exists' });
        }
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID, message: 'Leader added successfully' });
    }
  );
});

app.put('/api/leaders/:id', (req, res) => {
  const requiredCheck = validateRequiredFields(req.body, ['full_name', 'email', 'role']);
  if (!requiredCheck.valid) {
    return res.status(400).json({ error: requiredCheck.message });
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(req.body.email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  
  const { full_name, email, phone, role, department, responsibility, join_date, qualifications, is_active } = req.body;
  
  db.run(`
    UPDATE leaders SET 
      full_name = ?, email = ?, phone = ?, role = ?, department = ?,
      responsibility = ?, join_date = ?, qualifications = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [full_name, email, phone, role, department, responsibility, join_date, qualifications, is_active, req.params.id],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(409).json({ error: 'Email already exists' });
        }
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: 'Leader updated successfully' });
    }
  );
});

app.delete('/api/leaders/:id', (req, res) => {
  db.run("DELETE FROM leaders WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Leader deleted successfully' });
  });
});

// Attendance endpoints
app.post('/api/attendance', (req, res) => {
  const { member_type, member_id, service_date, service_type, present, notes } = req.body;
  
  if (!member_type || !member_id || !service_date) {
    return res.status(400).json({ error: 'member_type, member_id, and service_date are required' });
  }
  
  if (!['junior_youth', 'children_service'].includes(member_type)) {
    return res.status(400).json({ error: 'Invalid member_type. Must be junior_youth or children_service' });
  }
  
  db.run(`
    INSERT INTO attendance (member_type, member_id, service_date, service_type, present, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [member_type, member_id, service_date, service_type, present || 1, notes],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (present === 1) {
        const table = member_type === 'junior_youth' ? 'junior_youth' : 'children_service';
        db.run(`UPDATE ${table} SET attendance_count = attendance_count + 1 WHERE id = ?`, [member_id]);
      }
      res.json({ id: this.lastID, message: 'Attendance recorded' });
    }
  );
});

app.get('/api/attendance/:member_type/:member_id', (req, res) => {
  const { member_type, member_id } = req.params;
  
  if (!['junior_youth', 'children_service'].includes(member_type)) {
    return res.status(400).json({ error: 'Invalid member_type' });
  }
  
  db.all("SELECT * FROM attendance WHERE member_type = ? AND member_id = ? ORDER BY service_date DESC", 
    [member_type, member_id], 
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

app.get('/api/attendance/recent', (req, res) => {
  db.all(`
    SELECT a.*, 
      CASE 
        WHEN a.member_type = 'junior_youth' THEN j.full_name 
        WHEN a.member_type = 'children_service' THEN c.full_name 
      END as member_name
    FROM attendance a
    LEFT JOIN junior_youth j ON a.member_type = 'junior_youth' AND a.member_id = j.id
    LEFT JOIN children_service c ON a.member_type = 'children_service' AND a.member_id = c.id
    ORDER BY a.service_date DESC, a.created_at DESC
    LIMIT 50
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// Dashboard stats
app.get('/api/stats', (req, res) => {
  db.get("SELECT COUNT(*) as total_junior_youth FROM junior_youth", [], (err, juniorCount) => {
    if (err) return res.status(500).json({ error: err.message });
    db.get("SELECT COUNT(*) as total_children FROM children_service", [], (err, childrenCount) => {
      if (err) return res.status(500).json({ error: err.message });
      db.get("SELECT COUNT(*) as total_leaders FROM leaders WHERE is_active = 1", [], (err, leadersCount) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
          juniorYouth: juniorCount?.total_junior_youth || 0,
          children: childrenCount?.total_children || 0,
          leaders: leadersCount?.total_leaders || 0,
          total: (juniorCount?.total_junior_youth || 0) + (childrenCount?.total_children || 0)
        });
      });
    });
  });
});

// Batch import endpoints
app.post('/api/junior-youth/batch', (req, res) => {
  const { members } = req.body;
  if (!members || !Array.isArray(members) || members.length === 0) {
    return res.status(400).json({ error: 'Members array is required' });
  }
  
  const errors = [];
  const success = [];
  let completed = 0;
  
  members.forEach((member, index) => {
    if (!member.full_name || !member.age) {
      errors.push({ index, error: 'Missing required fields (full_name, age)' });
      completed++;
      return;
    }
    
    const ageValidation = validateJuniorYouthAge(member.age);
    if (!ageValidation.valid) {
      errors.push({ index, error: ageValidation.message });
      completed++;
      return;
    }
    
    const { full_name, age, gender, date_of_birth, parent_name, parent_phone, parent_email, address, school_name, class_level, medical_conditions, emergency_contact, emergency_phone, baptism_status, baptism_date, join_date } = member;
    
    db.run(`
      INSERT INTO junior_youth (full_name, age, gender, date_of_birth, parent_name, parent_phone, parent_email, address, school_name, class_level, medical_conditions, emergency_contact, emergency_phone, baptism_status, baptism_date, join_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [full_name, age, gender, date_of_birth, parent_name, parent_phone, parent_email, address, school_name, class_level, medical_conditions, emergency_contact, emergency_phone, baptism_status, baptism_date, join_date || new Date().toISOString().split('T')[0]],
      function(err) {
        if (err) {
          errors.push({ index, error: err.message });
        } else {
          success.push({ index, id: this.lastID });
        }
        completed++;
        if (completed === members.length) {
          res.json({ 
            message: `Batch import completed. ${success.length} added, ${errors.length} failed.`,
            success,
            errors
          });
        }
      }
    );
  });
});

app.post('/api/children/batch', (req, res) => {
  const { members } = req.body;
  if (!members || !Array.isArray(members) || members.length === 0) {
    return res.status(400).json({ error: 'Members array is required' });
  }
  
  const errors = [];
  const success = [];
  let completed = 0;
  
  members.forEach((member, index) => {
    if (!member.full_name || !member.age) {
      errors.push({ index, error: 'Missing required fields (full_name, age)' });
      completed++;
      return;
    }
    
    const ageValidation = validateChildrenAge(member.age);
    if (!ageValidation.valid) {
      errors.push({ index, error: ageValidation.message });
      completed++;
      return;
    }
    
    const { full_name, age, gender, date_of_birth, parent_name, parent_phone, parent_email, address, school_name, class_level, allergies, medical_conditions, emergency_contact, emergency_phone, baptism_status, baptism_date, join_date } = member;
    
    db.run(`
      INSERT INTO children_service (full_name, age, gender, date_of_birth, parent_name, parent_phone, parent_email, address, school_name, class_level, allergies, medical_conditions, emergency_contact, emergency_phone, baptism_status, baptism_date, join_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [full_name, age, gender, date_of_birth, parent_name, parent_phone, parent_email, address, school_name, class_level, allergies, medical_conditions, emergency_contact, emergency_phone, baptism_status, baptism_date, join_date || new Date().toISOString().split('T')[0]],
      function(err) {
        if (err) {
          errors.push({ index, error: err.message });
        } else {
          success.push({ index, id: this.lastID });
        }
        completed++;
        if (completed === members.length) {
          res.json({ 
            message: `Batch import completed. ${success.length} added, ${errors.length} failed.`,
            success,
            errors
          });
        }
      }
    );
  });
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🕊️  PCG Mount Zion Server running on http://localhost:${PORT}`);
  console.log(`📁 Database path: ${DB_PATH}`);
  console.log(`🔑 Admin login: admin@pcg.org / admin123`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Age Restrictions Enforced:`);
  console.log(`   • Junior Youth: 12-18 years`);
  console.log(`   • Children Service: 3-11 years`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🚦 Rate Limiting:`);
  console.log(`   • GET requests: 600 per minute (10 per second)`);
  console.log(`   • POST/PUT/DELETE: 300 per minute (5 per second)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
});