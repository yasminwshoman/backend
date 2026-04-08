const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const uploadsPath = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsPath);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: function (req, file, cb) {
    if (!file.originalname.toLowerCase().endsWith(".csv")) {
      return cb(new Error("Only CSV files are allowed"));
    }
    cb(null, true);
  }
});

let partitions = [];

app.get("/", (req, res) => {
  res.send("Backend server is running");
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  if (username === "admin" && password === "1234") {
    return res.json({ message: "Login successful" });
  }

  return res.status(401).json({ message: "Invalid login" });
});

app.get("/api/partitions", (req, res) => {
  res.json(partitions);
});

app.post("/api/partitions", (req, res) => {
  upload.single("csvFile")(req, res, function (err) {
    try {
      if (err) {
        console.error("UPLOAD ERROR:", err.message);
        return res.status(400).json({ message: err.message });
      }

      const { title } = req.body;

      if (!title || title.trim() === "") {
        return res.status(400).json({ message: "Partition title is required" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "CSV file is required" });
      }

      const newPartition = {
        id: partitions.length + 1,
        title: title.trim(),
        fileName: req.file.originalname
      };

      partitions.push(newPartition);

      return res.json({
        message: "Partition added successfully",
        partition: newPartition
      });
    } catch (error) {
      console.error("ADD PARTITION ERROR:", error);
      return res.status(500).json({ message: "Server error while adding partition" });
    }
  });
});

app.delete("/api/partitions/:id", (req, res) => {
  const id = parseInt(req.params.id);
  partitions = partitions.filter((p) => p.id !== id);
  res.json({ message: "Deleted successfully" });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});