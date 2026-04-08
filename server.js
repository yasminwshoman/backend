const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const session = require("express-session");

const app = express();
const PORT = 3000;

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: "dashboard-secret-key",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 1000 * 60 * 60
  }
}));

const uploadsPath = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}

app.use("/uploads", express.static(uploadsPath));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsPath);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, "_"));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 2 * 1024 * 1024
  },
  fileFilter: function (req, file, cb) {
    if (!file.originalname.toLowerCase().endsWith(".csv")) {
      return cb(new Error("Invalid file format. Please upload a CSV file."));
    }
    cb(null, true);
  }
});

let admin = {
  id: 1,
  username: "admin",
  email: "admin@example.com",
  password: "1234"
};

let partitions = [];
let activityLogs = [];

function addLog(actionType, actionDescription) {
  activityLogs.unshift({
    id: activityLogs.length + 1,
    actionType,
    actionDescription,
    timestamp: new Date().toISOString()
  });
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.isLoggedIn) {
    return res.status(401).json({ message: "Unauthorized access" });
  }
  next();
}

function readCsvPreview(filePath, maxRows = 10) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    if (!content.trim()) {
      return { headers: [], rows: [] };
    }

    const lines = content
      .split(/\r?\n/)
      .filter(line => line.trim() !== "");

    if (lines.length === 0) {
      return { headers: [], rows: [] };
    }

    const parseLine = (line) => {
      return line.split(",").map(cell => cell.trim());
    };

    const headers = parseLine(lines[0]);
    const rows = lines.slice(1, maxRows + 1).map(parseLine);

    return { headers, rows };
  } catch (error) {
    return { headers: [], rows: [] };
  }
}

function getStats() {
  const totalPartitions = partitions.length;
  const totalCsvFiles = partitions.length;
  const lastAddedPartition = partitions.length ? partitions[partitions.length - 1].title : "N/A";

  let lastUpdatedPartition = "N/A";
  if (partitions.length) {
    const sorted = [...partitions].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    lastUpdatedPartition = sorted[0].title;
  }

  return {
    totalPartitions,
    totalCsvFiles,
    lastAddedPartition,
    lastUpdatedPartition
  };
}

app.get("/", (req, res) => {
  res.send("Backend server is running");
});

app.get("/api/session", (req, res) => {
  if (req.session && req.session.isLoggedIn) {
    return res.json({ isLoggedIn: true });
  }
  return res.json({ isLoggedIn: false });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  if (
    (username === admin.username || username === admin.email) &&
    password === admin.password
  ) {
    req.session.isLoggedIn = true;
    req.session.adminId = admin.id;

    addLog("LOGIN", "Admin logged into the system");

    return res.json({
      message: "Login successful",
      admin: {
        username: admin.username,
        email: admin.email
      }
    });
  }

  return res.status(401).json({ message: "Invalid username/email or password" });
});

app.post("/api/logout", requireAuth, (req, res) => {
  addLog("LOGOUT", "Admin logged out");

  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: "Logout failed" });
    }
    res.json({ message: "Logout successful" });
  });
});

app.post("/api/change-password", requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: "All password fields are required" });
  }

  if (currentPassword !== admin.password) {
    return res.status(400).json({ message: "Current password is incorrect" });
  }

  if (newPassword.length < 4) {
    return res.status(400).json({ message: "New password must be at least 4 characters" });
  }

  admin.password = newPassword;
  addLog("PASSWORD_CHANGE", "Admin changed password");

  return res.json({ message: "Password changed successfully" });
});

app.get("/api/partitions", requireAuth, (req, res) => {
  let result = [...partitions];
  const search = (req.query.search || "").trim().toLowerCase();
  const sort = (req.query.sort || "").trim();

  if (search) {
    result = result.filter(p => p.title.toLowerCase().includes(search));
  }

  if (sort === "title") {
    result.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sort === "createdAt") {
    result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } else if (sort === "updatedAt") {
    result.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  res.json(result);
});

app.get("/api/stats", requireAuth, (req, res) => {
  res.json(getStats());
});

app.get("/api/logs", requireAuth, (req, res) => {
  res.json(activityLogs.slice(0, 20));
});

app.post("/api/partitions", requireAuth, (req, res) => {
  upload.single("csvFile")(req, res, function (err) {
    try {
      if (err) {
        return res.status(400).json({ message: err.message });
      }

      const { title } = req.body;

      if (!title || !title.trim()) {
        return res.status(400).json({ message: "Partition title is required" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "CSV file is required" });
      }

      const duplicate = partitions.find(
        p => p.title.toLowerCase() === title.trim().toLowerCase()
      );

      if (duplicate) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: "Partition title already exists" });
      }

      const preview = readCsvPreview(req.file.path);
      if (!preview.headers.length) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: "Empty or invalid CSV file" });
      }

      const now = new Date().toISOString();

      const newPartition = {
        id: partitions.length ? partitions[partitions.length - 1].id + 1 : 1,
        title: title.trim(),
        originalFileName: req.file.originalname,
        storedFileName: req.file.filename,
        filePath: req.file.path,
        createdAt: now,
        updatedAt: now
      };

      partitions.push(newPartition);
      addLog("ADD_PARTITION", `Added partition: ${newPartition.title}`);

      return res.json({
        message: "Partition added successfully",
        partition: newPartition
      });
    } catch (error) {
      return res.status(500).json({ message: "Server error while adding partition" });
    }
  });
});

app.put("/api/partitions/:id", requireAuth, (req, res) => {
  upload.single("csvFile")(req, res, function (err) {
    try {
      if (err) {
        return res.status(400).json({ message: err.message });
      }

      const id = parseInt(req.params.id, 10);
      const partition = partitions.find(p => p.id === id);

      if (!partition) {
        if (req.file && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(404).json({ message: "Partition not found" });
      }

      const { title } = req.body;

      if (title && title.trim()) {
        const duplicate = partitions.find(
          p => p.id !== id && p.title.toLowerCase() === title.trim().toLowerCase()
        );

        if (duplicate) {
          if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }
          return res.status(400).json({ message: "Partition title already exists" });
        }

        partition.title = title.trim();
      }

      if (req.file) {
        const preview = readCsvPreview(req.file.path);
        if (!preview.headers.length) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ message: "Empty or invalid CSV file" });
        }

        if (partition.filePath && fs.existsSync(partition.filePath)) {
          fs.unlinkSync(partition.filePath);
        }

        partition.originalFileName = req.file.originalname;
        partition.storedFileName = req.file.filename;
        partition.filePath = req.file.path;

        addLog("REPLACE_FILE", `Replaced CSV file in partition: ${partition.title}`);
      }

      partition.updatedAt = new Date().toISOString();

      addLog("EDIT_PARTITION", `Updated partition: ${partition.title}`);

      return res.json({
        message: "Partition updated successfully",
        partition
      });
    } catch (error) {
      return res.status(500).json({ message: "Server error while updating partition" });
    }
  });
});

app.delete("/api/partitions/:id", requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const index = partitions.findIndex(p => p.id === id);

  if (index === -1) {
    return res.status(404).json({ message: "Partition not found" });
  }

  const partition = partitions[index];

  if (partition.filePath && fs.existsSync(partition.filePath)) {
    fs.unlinkSync(partition.filePath);
  }

  partitions.splice(index, 1);
  addLog("DELETE_PARTITION", `Deleted partition: ${partition.title}`);

  res.json({ message: "Partition deleted successfully" });
});

app.get("/api/partitions/:id/preview", requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const partition = partitions.find(p => p.id === id);

  if (!partition) {
    return res.status(404).json({ message: "Partition not found" });
  }

  const preview = readCsvPreview(partition.filePath);
  res.json(preview);
});

app.get("/api/partitions/:id/download", requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const partition = partitions.find(p => p.id === id);

  if (!partition) {
    return res.status(404).json({ message: "Partition not found" });
  }

  res.download(partition.filePath, partition.originalFileName);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
